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
import {
  districtAssignments,
  ownBlock,
  requestedBlock,
  profileBlockFilter,
} from "../../../lib/district-scope";
import { rosterRows } from "../../../lib/roster";
import { randomBytes } from "node:crypto";

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
          profileBlockFilter(blockId) +
          "&select=id,name,phone,email,secondary_phones,assignments,role,block,block_id,active,gender,staff_scope,district_name&order=name",
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
      !["create", "update", "delete", "reset_password", "provision"].includes(
        b.action,
      )
    )
      throw new HttpError(400, "कार्रवाई अमान्य।");
    // Audit the authenticated actor and operation without asking for a reason.
    const reason = {
      create: "Administrator added a staff account",
      update: "Administrator updated staff details",
      delete: "Administrator removed a staff account",
      reset_password: "Administrator reset the staff password",
      provision: "Administrator created a login for a directory staff member",
    }[
      b.action as
        "create" | "update" | "delete" | "reset_password" | "provision"
    ];
    if (b.action === "create") {
      const districtStaff = b.staff_scope === "district";
      if (districtStaff && profile.role !== "dpro")
        throw new HttpError(403, "DPRO access required.");
      if (
        b.staff_scope != null &&
        !["block", "district"].includes(b.staff_scope)
      )
        throw new HttpError(400, "Invalid staff scope.");
      if (
        b.request_id != null &&
        (typeof b.request_id !== "string" ||
          !/^[0-9a-f-]{36}$/.test(b.request_id))
      )
        throw new HttpError(400, "Invalid save request. Reopen Add staff.");
      const blockId = ownBlock(profile, b.block_id);
      const blockRows = await sb(
        `/rest/v1/blocks?id=eq.${blockId}&active=eq.true&select=id,name_en,district_name`,
        {},
        token,
      );
      if (!blockRows.length)
        throw new HttpError(400, "Choose an active block.");
      validateRoster(b);
      if (!/^[6-9]\d{9}$/.test(b.phone || ""))
        throw new HttpError(
          400,
          "A mobile number is required to create a staff login.",
        );
      const assignments = districtAssignments(
        b.assignments,
        blockId,
        districtStaff,
      );
      const districtName = blockRows[0].district_name || "Araria";
      if (b.district_name && b.district_name !== districtName)
        throw new HttpError(
          400,
          "Choose a primary block in the selected district.",
        );
      const [existingProfile, existingRoster] = await Promise.all([
        sb(
          `/rest/v1/profiles?phone=eq.${b.phone}&deleted_at=is.null&select=id,block_id`,
        ),
        sb(
          `/rest/v1/staff_roster?phone=eq.${b.phone}&deleted_at=is.null&select=id,block_id`,
        ),
      ]);
      if (existingProfile.length || existingRoster.length) {
        // A retry of this administrator's successful save returns its result,
        // rather than asking them to add or reset the same account again.
        const candidate = existingProfile.find(
          (entry: { id: string; block_id: string }) =>
            entry.block_id === blockId,
        );
        if (candidate && b.request_id) {
          const account = await sb(`/auth/v1/admin/users/${candidate.id}`);
          if (
            account.user_metadata?.create_request_id === b.request_id &&
            account.user_metadata?.created_by === profile.id
          ) {
            const saved = await sb(
              `/rest/v1/profiles?id=eq.${candidate.id}&select=id,name,phone,email,gender,staff_scope,district_name,assignments,block,block_id,role,active`,
              {},
              token,
            );
            return json({
              profile: saved[0],
              password: `${districtStaff ? "DistAraria" : blockRows[0].name_en}@${b.phone.slice(-4)}#26`,
              recovered: true,
            });
          }
        }
        const matches = [...existingProfile, ...existingRoster];
        const canOpen =
          profile.role === "dpro" ||
          matches.some((entry) => entry.block_id === profile.block_id);
        return json(
          {
            error: canOpen
              ? "This mobile number already belongs to a staff entry. Open the existing entry below to edit it or generate its pending login."
              : "This mobile number is registered in another block. Ask DPRO to check the existing account before adding a different person.",
            ...(canOpen
              ? {
                  existing: {
                    phone: b.phone,
                    name: "Existing staff",
                    removed: false,
                  },
                }
              : {}),
          },
          409,
        );
      }
      // A former account may still exist in Auth to preserve historical
      // attendance references. Use a fresh internal email for each login.
      const loginEmail = `${b.phone}.${randomBytes(8).toString("hex")}@staff.araria.invalid`;
      const password = `${districtStaff ? "DistAraria" : blockRows[0].name_en}@${b.phone.slice(-4)}#26`;
      const user = await sb("/auth/v1/admin/users", {
        method: "POST",
        body: JSON.stringify({
          email: loginEmail,
          password,
          email_confirm: true,
          user_metadata: {
            name: b.name.trim(),
            provisioned_by: "admin_dashboard",
            create_request_id: b.request_id || null,
            created_by: profile.id,
          },
        }),
      });
      try {
        const created = await sb(
          "/rest/v1/profiles?select=id,name,phone,email,gender,staff_scope,district_name,assignments,block,block_id,role,active",
          {
            method: "POST",
            headers: { Prefer: "return=representation" },
            body: JSON.stringify({
              id: user.id,
              block_id: blockId,
              staff_scope: districtStaff ? "district" : "block",
              district_name: districtName,
              block: blockRows[0].name_en,
              name: b.name.trim(),
              phone: b.phone,
              email: b.email || null,
              login_email: loginEmail,
              gender: b.gender || null,
              assignments,
              role: "staff",
              active: true,
            }),
          },
        );
        try {
          await audit(
            profile.id,
            "create_staff",
            user.id,
            reason,
            null,
            blockId,
          );
        } catch {
          // The login is already provisioned; never invite a duplicate retry.
          console.error("Staff creation audit write failed");
        }
        return json({ profile: created[0], password });
      } catch (error) {
        try {
          const existing = await sb(
            `/rest/v1/profiles?id=eq.${user.id}&select=id`,
          );
          if (!existing.length)
            await sb(`/auth/v1/admin/users/${user.id}`, { method: "DELETE" });
        } catch {
          console.error("Staff provisioning cleanup failed");
        }
        throw error;
      }
    }
    if (typeof b.id !== "string" || !/^[0-9a-f-]{36}$/.test(b.id))
      throw new HttpError(400, "मान्य कर्मी चुनें।");
    const rosterTarget = await sb(
      `/rest/v1/staff_roster?id=eq.${b.id}&select=id,name,phone,email,gender,assignments,block_id,active,deleted_at,linked_profile_id`,
      {},
      token,
    );
    if (rosterTarget.length) {
      const target = rosterTarget[0];
      if (target.deleted_at)
        throw new HttpError(404, "Staff is not in the directory.");
      if (profile.role === "bpro" && target.block_id !== profile.block_id)
        throw new HttpError(403, "This staff member is outside your block.");
      if (b.action === "provision") {
        if (!target.active || target.linked_profile_id)
          throw new HttpError(
            409,
            "This directory entry cannot receive a new login.",
          );
        if (!/^[6-9]\d{9}$/.test(target.phone || ""))
          throw new HttpError(
            400,
            "Add a valid mobile number before generating a login.",
          );
        const assignments = districtAssignments(
          target.assignments,
          target.block_id,
        );
        const [samePhoneProfiles, samePhoneRoster, blockRows] =
          await Promise.all([
            sb(`/rest/v1/profiles?phone=eq.${target.phone}&select=id`),
            sb(
              `/rest/v1/staff_roster?phone=eq.${target.phone}&active=eq.true&deleted_at=is.null&select=id`,
            ),
            sb(
              `/rest/v1/blocks?id=eq.${target.block_id}&active=eq.true&select=name_en`,
              {},
              token,
            ),
          ]);
        if (
          samePhoneProfiles.length ||
          samePhoneRoster.length !== 1 ||
          samePhoneRoster[0].id !== target.id
        )
          throw new HttpError(
            409,
            "This mobile number belongs to another directory entry or login. Correct it first.",
          );
        if (!blockRows.length)
          throw new HttpError(400, "Choose an active block.");
        const loginEmail = `${target.phone}.${randomBytes(8).toString("hex")}@staff.araria.invalid`;
        const password = `${blockRows[0].name_en}@${target.phone.slice(-4)}#26`;
        const user = await sb("/auth/v1/admin/users", {
          method: "POST",
          body: JSON.stringify({
            email: loginEmail,
            password,
            email_confirm: true,
            user_metadata: {
              name: target.name,
              roster_source_key: target.id,
              provisioned_by: "admin_dashboard",
            },
          }),
        });
        try {
          const created = await sb(
            "/rest/v1/profiles?select=id,name,phone,email,gender,staff_scope,district_name,assignments,block,block_id,role,active",
            {
              method: "POST",
              headers: { Prefer: "return=representation" },
              body: JSON.stringify({
                id: user.id,
                block_id: target.block_id,
                block: blockRows[0].name_en,
                name: target.name,
                phone: target.phone,
                email: target.email || null,
                login_email: loginEmail,
                gender: target.gender || null,
                assignments,
                role: "staff",
                active: true,
              }),
            },
          );
          const linked = await sb(
            `/rest/v1/staff_roster?id=eq.${target.id}&linked_profile_id=is.null&active=eq.true&deleted_at=is.null&select=id`,
            {
              method: "PATCH",
              headers: { Prefer: "return=representation" },
              body: JSON.stringify({ linked_profile_id: user.id }),
            },
          );
          if (linked.length !== 1)
            throw new HttpError(
              409,
              "Directory changed. Refresh and try again.",
            );
          try {
            await audit(
              profile.id,
              "provision_staff_login",
              user.id,
              reason,
              null,
              target.block_id,
            );
          } catch {
            console.error("Staff provisioning audit write failed");
          }
          return json({ profile: created[0], password });
        } catch (error) {
          try {
            await sb(`/rest/v1/profiles?id=eq.${user.id}`, {
              method: "DELETE",
            });
            await sb(`/auth/v1/admin/users/${user.id}`, { method: "DELETE" });
          } catch {
            console.error("Staff provisioning cleanup failed");
          }
          throw error;
        }
      }
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
      if (b.action === "delete") {
        await audit(
          profile.id,
          "delete_roster_staff",
          b.id,
          reason,
          null,
          target.block_id,
        );
        await sb(`/rest/v1/staff_roster?id=eq.${b.id}`, { method: "DELETE" });
        return json({ success: true });
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
      const target = await sb(
        `/rest/v1/profiles?id=eq.${b.id}&select=id,staff_scope`,
        {},
        token,
      );
      if (profile.role === "bpro" && target[0]?.staff_scope === "district")
        throw new HttpError(403, "District staff are managed by DPRO only.");
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
        `/rest/v1/profiles?id=eq.${b.id}&role=eq.staff&select=id,block_id,staff_scope`,
        {},
        token,
      );
      if (!target.length)
        throw new HttpError(403, "This staff member is outside your block.");
      if (
        target[0].staff_scope === "district" ||
        changes.staff_scope === "district" ||
        (profile.role === "dpro" && changes.staff_scope === "block")
      ) {
        if (profile.role !== "dpro")
          throw new HttpError(403, "District staff are managed by DPRO only.");
        const home = changes.block_id || target[0].block_id;
        changes.assignments = districtAssignments(
          changes.assignments,
          home,
          changes.staff_scope !== "block",
        );
        const record = await sb("/rest/v1/rpc/manage_district_staff", {
          method: "POST",
          body: JSON.stringify({
            actor_id: profile.id,
            target_id: b.id,
            changes,
          }),
        });
        return json({ profile: record });
      }
      delete changes.staff_scope;
      delete changes.district_name;
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
        "&select=id,role,phone,block,block_id,deleted_at,staff_scope",
      {},
      token,
    );
    const target = targets[0];
    if (!target || target.role !== "staff")
      throw new HttpError(403, "कर्मी प्रबंधन की अनुमति नहीं।");
    if (profile.role === "bpro" && target.block_id !== profile.block_id)
      throw new HttpError(403, "कर्मी प्रबंधन की अनुमति नहीं।");
    if (b.action === "reset_password") {
      if (profile.role !== "dpro")
        throw new HttpError(403, "Super Admin आवश्यक।");
      if (!target.phone)
        throw new HttpError(
          400,
          "ईमेल खाते का पासवर्ड Supabase Admin से रीसेट करें।",
        );
      const blockRows = await sb(
        `/rest/v1/blocks?id=eq.${target.block_id}&select=name_en`,
        {},
        token,
      );
      if (!blockRows.length) throw new HttpError(400, "Choose a valid block.");
      const password = `${target.staff_scope === "district" ? "DistAraria" : blockRows[0].name_en}@${target.phone.slice(-4)}#26`;
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
