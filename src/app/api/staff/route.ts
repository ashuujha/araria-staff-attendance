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
      String(b.reason || "").trim().length < 10 ||
      String(b.reason).length > 1000
    )
      throw new HttpError(400, "कर्मी एवं सुधार कारण आवश्यक।");
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
        throw new HttpError(400, "कर्मी विवरण या कारण अमान्य है।");
      const existing = await sb(
        "/rest/v1/profiles?phone=eq." + phone + "&select=id",
      );
      if (existing.length)
        throw new HttpError(409, "यह मोबाइल पहले से दर्ज है।");
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
            reason_text: b.reason,
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
    if (
      !/^[0-9a-f-]{36}$/.test(b.id) ||
      String(b.reason || "").trim().length < 10
    )
      throw new HttpError(400, "कर्मी एवं सुधार कारण आवश्यक।");
    const targets = await sb(
      "/rest/v1/profiles?id=eq." + b.id + "&select=id,role,phone",
      {},
      token,
    );
    const target = targets[0];
    if (!target || target.role !== "staff")
      throw new HttpError(403, "कर्मी प्रबंधन की अनुमति नहीं।");
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
      await audit(profile.id, "reset_password", target.id, b.reason, {
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
          reason_text: b.reason,
        }),
      });
      return json({ success: true });
    }
    if (b.action !== "update") throw new HttpError(400, "कार्रवाई अमान्य।");
    const record = await sb("/rest/v1/rpc/manage_staff", {
      method: "POST",
      body: JSON.stringify({
        actor_id: profile.id,
        target_id: target.id,
        changes: b.changes,
        reason_text: b.reason,
      }),
    });
    return json({ profile: record });
  } catch (e) {
    return failure(e);
  }
}
