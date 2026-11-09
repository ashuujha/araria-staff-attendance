"use client";
import type { Profile } from "../lib/types";
import { BIHAR_EMBLEM, departmentBranding } from "../lib/department-branding";
import { Localized } from "../lib/portal-language";

export default function DepartmentBrand({
  profile,
  selected,
  adminLogin,
}: {
  profile: Profile | null;
  selected: string;
  adminLogin: boolean;
}) {
  const branding =
    profile?.role === "staff"
      ? departmentBranding(profile.assignments, selected)
      : null;
  return (
    <Localized>
      <a href={profile?.role === "bpro" ? "/bpro" : adminLogin ? "/dpro" : "/"} className="sp-brand">
        <span
          className="sp-mark sp-department-mark"
          title="Government of Bihar"
        >
          <img
            src={BIHAR_EMBLEM}
            alt="बिहार सरकार का चिह्न / Government of Bihar emblem"
            width={44}
            height={44}
            decoding="async"
            referrerPolicy="no-referrer"
          />
        </span>
        <span className="sp-brand-copy">
          अररिया कर्मी उपस्थिति
          <small translate="no" title={branding?.label || undefined}>
            {branding?.label || "Araria Staff Attendance"}
          </small>
        </span>
      </a>
    </Localized>
  );
}
