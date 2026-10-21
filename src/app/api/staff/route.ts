import {
  csrf,
  identity,
  admin,
  sb,
  json,
  failure,
  HttpError,
  audit,
} from "../../../lib/server";
export async function GET(req: Request) {
  try {
    const { profile, token } = await identity(req);
    admin(profile);
    const staff = await sb(
      "/rest/v1/profiles?role=eq.staff&deleted_at=is.null&select=id,name,phone,email,secondary_phones,assignments,role,block,active&order=name",
      {},
      token,
    );
    return json({ staff });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    csrf(req);
    const { profile, token } = await identity(req);
    admin(profile, true);
    const b = await req.json();
    if (
      !b ||
      typeof b !== "object" ||
      Array.isArray(b) ||
      !["create", "update", "delete", "restore", "reset_password"].includes(
        b.action,
      )
    )
      throw new HttpError(400, "कार्रवाई अमान्य।");
    // Audit the authenticated actor and operation without asking for a reason.
    const reason = {
      create: "Administrator added a staff account",
      update: "Administrator updated staff details",
      delete: "Administrator removed a staff account",
      restore: "Administrator restored a staff account",
      reset_password: "Administrator reset the staff password",
    }[
      b.action as "create" | "update" | "delete" | "restore" | "reset_password"
    ];
    if (b.action === "create") {
      const name = String(b.name || "").trim(),
        phone = String(b.phone || "").trim(),
        email = String(b.email || "")
          .trim()
          .toLowerCase();
      if (
        name.length < 2 ||
        name.length > 150 ||
        !/^[6-9]\d{9}$/.test(phone) ||
        (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) ||
        email.length > 254
      )
        throw new HttpError(400, "कर्मी विवरण अमान्य है।");
      const existing = await sb(
        "/rest/v1/profiles?phone=eq." +
          phone +
          "&select=id,name,phone,role,block,deleted_at",
      );
      if (existing.length) {
        const match = existing[0];
        const inScope =
          profile.role === "super_admin" || profile.block === match.block;
        return json(
          {
            error:
              match.role === "staff" && inScope
                ? match.deleted_at
                  ? "यह मोबाइल हटाए गए कर्मी के खाते में है। Staff directory में Removed staff देखें और खाता बहाल करें।"
                  : "यह मोबाइल पहले से दर्ज है। Staff directory में इस नंबर को देखें।"
                : "यह मोबाइल किसी अन्य खाते में पहले से दर्ज है। जिला प्रशासक से संपर्क करें।",
            ...(match.role === "staff" && inScope
              ? {
                  existing: {
                    id: match.id,
                    name: match.name,
                    phone: match.phone,
                    removed: !!match.deleted_at,
                  },
                }
              : {}),
          },
          409,
        );
      }
      const loginEmail = email || `${phone}@staff.araria.invalid`;
      const password = `Araria@${phone.slice(-4)}#26`;
      const user = await sb("/auth/v1/admin/users", {
        method: "POST",
        body: JSON.stringify({
          email: loginEmail,
          password,
          email_confirm: true,
          user_metadata: { name, must_change_password: true },
        }),
      });
      try {
        const result = await sb("/rest/v1/rpc/create_master_staff", {
          method: "POST",
          body: JSON.stringify({
            actor_id: profile.id,
            user_id: user.id,
            staff_name: name,
            staff_phone: phone,
            staff_email: email,
            auth_email: loginEmail,
            block_name: profile.block,
            workplaces: b.assignments,
            reason_text: reason,
          }),
        });
        return json({ profile: result, password });
      } catch (e) {
        await sb("/auth/v1/admin/users/" + user.id, { method: "DELETE" }).catch(
          () => {},
        );
        throw e;
      }
    }
    if (typeof b.id !== "string" || !/^[0-9a-f-]{36}$/.test(b.id))
      throw new HttpError(400, "मान्य कर्मी चुनें।");
    const targets = await sb(
      "/rest/v1/profiles?id=eq." +
        b.id +
        "&select=id,role,phone,block,deleted_at",
      {},
      token,
    );
    const target = targets[0];
    if (!target || target.role !== "staff")
      throw new HttpError(403, "कर्मी प्रबंधन की अनुमति नहीं।");
    if (profile.role === "block_admin" && target.block !== profile.block)
      throw new HttpError(403, "कर्मी प्रबंधन की अनुमति नहीं।");
    if (b.action === "restore") {
      if (!target.deleted_at)
        throw new HttpError(409, "यह कर्मी पहले से सक्रिय सूची में है।");
      const restored = await sb(
        "/rest/v1/profiles?id=eq." +
          b.id +
          "&deleted_at=not.is.null&select=id,name,phone,email,assignments,role,block,active",
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ deleted_at: null, active: true }),
        },
      );
      if (!restored.length)
        throw new HttpError(
          409,
          "खाता पहले ही बहाल हो चुका है। रीफ़्रेश करें।",
        );
      try {
        await audit(profile.id, "restore_staff", target.id, reason, {
          prior_deleted_at: target.deleted_at,
        });
      } catch {
        // Restoration has already committed; never report it as failed.
        console.error("Staff restore audit write failed");
      }
      return json({ profile: restored[0] });
    }
    if (b.action === "reset_password") {
      if (profile.role !== "super_admin")
        throw new HttpError(403, "Super Admin आवश्यक।");
      if (!target.phone)
        throw new HttpError(
          400,
          "ईमेल खाते का पासवर्ड Supabase Admin से रीसेट करें।",
        );
      const password = `Araria@${target.phone.slice(-4)}#26`;
      await sb("/auth/v1/admin/users/" + target.id, {
        method: "PUT",
        body: JSON.stringify({
          password,
          user_metadata: { must_change_password: true },
        }),
      });
      await audit(profile.id, "reset_password", target.id, reason, {
        password_changed: true,
      });
      return json({ password });
    }
    if (b.action === "delete") {
      await sb("/rest/v1/rpc/delete_master_staff", {
        method: "POST",
        body: JSON.stringify({
          actor_id: profile.id,
          target_id: target.id,
          reason_text: reason,
        }),
      });
      return json({ success: true });
    }
    if (b.action !== "update") throw new HttpError(400, "कार्रवाई अमान्य।");
    const changes = b.changes;
    if (
      !changes ||
      typeof changes !== "object" ||
      Array.isArray(changes) ||
      ("name" in changes &&
        (typeof changes.name !== "string" ||
          changes.name.trim().length < 2 ||
          changes.name.length > 150)) ||
      ("phone" in changes &&
        (typeof changes.phone !== "string" ||
          !/^[6-9]\d{9}$/.test(changes.phone))) ||
      ("email" in changes &&
        changes.email !== null &&
        (typeof changes.email !== "string" ||
          changes.email.length > 254 ||
          (changes.email &&
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(changes.email)))) ||
      ("active" in changes && typeof changes.active !== "boolean")
    )
      throw new HttpError(400, "कर्मी विवरण अमान्य है।");
    const record = await sb("/rest/v1/rpc/manage_staff", {
      method: "POST",
      body: JSON.stringify({
        actor_id: profile.id,
        target_id: target.id,
        changes: b.changes,
        reason_text: reason,
      }),
    });
    return json({ profile: record });
  } catch (e) {
    return failure(e);
  }
}
