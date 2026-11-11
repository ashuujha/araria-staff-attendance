export type Assignment = {
  panchayat: string;
  position: string;
  department: string;
  block_id?: string;
};
export type Profile = {
  id: string;
  name: string;
  role: "staff" | "bpro" | "dpro";
  phone: string;
  email: string | null;
  assignments: Assignment[];
  block: string;
  block_id: string;
  active: boolean;
  gender?: "female" | "male" | null;
  deleted_at?: string | null;
  roster_only?: boolean;
};
export type LeaveBalance = {
  staff_id: string;
  gender: "female" | "male" | null;
  cl_used: number;
  cl_left: number;
  sl_used: number;
  sl_left: number;
  sl_month_used: number;
  sl_month_left: number;
};
export type LeaveBalanceSnapshot = {
  year: number;
  month: number;
  balances: LeaveBalance[];
};
export type Attendance = {
  id: string;
  staff_id: string;
  date: string;
  panchayat: string;
  status: "present" | "absent" | "leave" | "deputation" | "on_duty";
  phase?: "draft" | "submitted";
  department?: string | null;
  position?: string | null;
  block?: string | null;
  staff_name?: string | null;
  deputation_workplace?: string | null;
  leave_type?: "CL" | "SL" | "MATERNITY" | "PATERNITY" | "OTHER" | null;
  deleted_at?: string | null;
  working_places?: Assignment[];
  time_in: string | null;
  time_out: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  photo_path: string | null;
  out_photo_path?: string | null;
  out_location?: {
    latitude: number;
    longitude: number;
    accuracy?: number;
  } | null;
  leave_path: string | null;
  flags: string[];
  profiles?: Profile;
};
