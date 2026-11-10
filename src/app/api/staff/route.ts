import {
  csrf,
  identity,
  admin,
  sb,
  json,
  failure,
  HttpError,
  audit,
  randomUUID,
} from "../../../lib/server";
import {
  districtAssignments,
  ownBlock,
  requestedBlock,
} from "../../../lib/district-scope";
import { rosterRows } from "../../../lib/roster";

const validPhone = (value: unknown) =>
  value == null ||
  value === "" ||
  (typeof value === "string" && /^[6-9]\d{9}$/.test(value));
const validGender = (value: unknown) =>
  value == null || value === "" || value === "female" || value === "male";
const validEmail = (value: unknown) =>
  value == null ||
  value === "" ||
  (typeof value === "string" &&
    value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
function validateRoster(values: Record<string, unknown>) {
  if (
    typeof values.name !== "string" ||
    values.name.trim().length < 2 ||
    values.name.length > 150 ||
    !validPhone(values.phone) ||
    !validGender(values.gender) ||
    !validEmail(values.email)
  )
    throw new HttpError(400, "Invalid staff details.");
}
export async function GET(req: Request) {
  try {
    const { profile, token } = await identity(req);
    admin(profile);
    const blockId = requestedBlock(
      profile,
      new URL(req.url).searchParams.get("block_id"),
    );
    const [staff, roster] = await Promise.all([
      sb(
        "/rest/v1/profiles?role=eq.staff&deleted_at=is.null" +
          (blockId ? `&block_id=eq.${blockId}` : "") +
          "&select=id,name,phone,email,secondary_phones,assignments,role,block,block_id,active,gender&order=name",
        {},
        token,
      ),
      rosterRows(token, blockId),
    ]);
    return json({
      staff: [...staff, ...roster].sort((a, b) => a.name.localeCompare(b.name)),
    });
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
      const blockId = ownBlock(profile, b.block_id);
      const blockRows = await sb(
        `/rest/v1/blocks?id=eq.${blockId}&active=eq.true&select=id,name_en`,
        {},
        token,
      );
      if (!blockRows.length)
        throw new HttpError(400, "Choose an active block.");
      validateRoster(b);
      const created = await sb(
        "/rest/v1/staff_roster?select=id,name,phone,email,gender,assignments,block_id,active",
        {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            id: randomUUID(),
            block_id: blockId,
            name: b.name.trim(),
            phone: b.phone || null,
            email: b.email || null,
            gender: b.gender || null,
            assignments: districtAssignments(b.assignments, blockId),
          }),
        },
      );
      await audit(
        profile.id,
        "create_roster_staff",
        created[0].id,
        reason,
        null,
        blockId,
      );
      return json({
        profile: {
          ...created[0],
          phone: created[0].phone || "",
          block: blockRows[0].name_en,
          role: "staff",
          roster_only: true,
        },
      });
    }
    if (typeof b.id !== "string" || !/^[0-9a-f-]{36}$/.test(b.id))
      throw new HttpError(400, "मान्य कर्मी चुनें।");
    const rosterTarget = await sb(
      `/rest/v1/staff_roster?id=eq.${b.id}&select=id,block_id,deleted_at`,
      {},
      token,
    );
    if (rosterTarget.length) {
      const target = rosterTarget[0];
      if (profile.role === "bpro" && target.block_id !== profile.block_id)
        throw new HttpError(403, "This staff member is outside your block.");
      if (b.action === "reset_password")
        throw new HttpError(409, "Staff login has not been created yet.");
      const changes = b.action === "update" ? b.changes : {};
      if (
        b.action === "update" &&
        (!changes || typeof changes !== "object" || Array.isArray(changes))
      )
        throw new HttpError(400, "Invalid staff details.");
      const nextBlock =
        b.action === "update" && changes.block_id
          ? ownBlock(profile, changes.block_id)
          : target.block_id;
      if (profile.role === "bpro" && nextBlock !== profile.block_id)
        throw new HttpError(403, "This staff member is outside your block.");
      const patch: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (b.action === "delete")
        Object.assign(patch, {
          deleted_at: new Date().toISOString(),
          active: false,
        });
      else if (b.action === "restore")
        Object.assign(patch, { deleted_at: null, active: true });
      else if (b.action === "update") {
        validateRoster(changes);
        Object.assign(patch, {
          block_id: nextBlock,
          name: changes.name.trim(),
          phone: changes.phone || null,
          email: changes.email || null,
          gender: changes.gender || null,
          active: changes.active,
          assignments: districtAssignments(changes.assignments, nextBlock),
        });
      }
      const updated = await sb(
        `/rest/v1/staff_roster?id=eq.${b.id}&select=id,name,phone,email,gender,assignments,block_id,active,deleted_at`,
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify(patch),
        },
      );
      if (!updated.length)
        throw new HttpError(409, "Staff changed. Refresh and try again.");
      await audit(
        profile.id,
        `${b.action}_roster_staff`,
        b.id,
        reason,
        null,
        target.block_id,
      );
      const block = await sb(
        `/rest/v1/blocks?id=eq.${nextBlock}&select=name_en`,
        {},
        token,
      );
      return json({
        profile: {
          ...updated[0],
          phone: updated[0].phone || "",
          block: block[0]?.name_en || "",
          role: "staff",
          roster_only: true,
        },
      });
    }
    if (b.action === "delete") {
      // The RPC validates the actor, target role and block in one transaction.
      await sb("/rest/v1/rpc/delete_master_staff", {
        method: "POST",
        body: JSON.stringify({
          actor_id: profile.id,
          target_id: b.id,
          reason_text: reason,
        }),
      });
      return json({ success: true });
    }
    if (b.action === "update") {
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
        ("active" in changes && typeof changes.active !== "boolean") ||
        ("gender" in changes && !["female", "male"].includes(changes.gender))
      )
        throw new HttpError(400, "कर्मी विवरण अमान्य है।");
      const target = await sb(
        `/rest/v1/profiles?id=eq.${b.id}&role=eq.staff&select=id,block_id`,
        {},
        token,
      );
      if (!target.length)
        throw new HttpError(403, "This staff member is outside your block.");
      const moving =
        "block_id" in changes && changes.block_id !== target[0].block_id;
      if (
        profile.role === "bpro" &&
        (target[0].block_id !== profile.block_id || moving)
      )
        throw new HttpError(403, "This staff member is outside your block.");
      if (moving) {
        if (profile.role !== "dpro")
          throw new HttpError(403, "DPRO access required.");
        const destination = ownBlock(profile, changes.block_id);
        const record = await sb("/rest/v1/rpc/move_staff_block", {
          method: "POST",
          body: JSON.stringify({
            actor_id: profile.id,
            target_id: b.id,
            destination_id: destination,
            changes: {
              ...changes,
              assignments: districtAssignments(
                changes.assignments,
                destination,
              ),
            },
          }),
        });
        return json({ profile: record });
      }
      delete changes.block_id;
      if ("assignments" in changes)
        changes.assignments = districtAssignments(
          changes.assignments,
          target[0].block_id,
        );
      // The RPC performs the same scope checks while locking the staff row.
      const record = await sb("/rest/v1/rpc/manage_staff_with_gender", {
        method: "POST",
        body: JSON.stringify({
          actor_id: profile.id,
          target_id: b.id,
          changes,
          reason_text: reason,
        }),
      });
      return json({ profile: record });
    }
    const targets = await sb(
      "/rest/v1/profiles?id=eq." +
        b.id +
        "&select=id,role,phone,block,block_id,deleted_at",
      {},
      token,
    );
    const target = targets[0];
    if (!target || target.role !== "staff")
      throw new HttpError(403, "कर्मी प्रबंधन की अनुमति नहीं।");
    if (profile.role === "bpro" && target.block_id !== profile.block_id)
      throw new HttpError(403, "कर्मी प्रबंधन की अनुमति नहीं।");
    if (b.action === "restore") {
      if (!target.deleted_at)
        throw new HttpError(409, "यह कर्मी पहले से सक्रिय सूची में है।");
      const restored = await sb(
        "/rest/v1/profiles?id=eq." +
          b.id +
          "&deleted_at=not.is.null&select=id,name,phone,email,assignments,role,block,active,gender",
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
      if (profile.role !== "dpro")
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
    throw new HttpError(400, "कार्रवाई अमान्य।");
  } catch (e) {
    return failure(e);
  }
}
