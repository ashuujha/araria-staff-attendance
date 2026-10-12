export type Assignment = {
  panchayat: string;
  position: string;
  department: string;
};
export type Profile = {
  id: string;
  name: string;
  role: "staff" | "super_admin" | "district_viewer" | "block_admin";
  phone: string;
  email: string | null;
  assignments: Assignment[];
  block: string;
  active: boolean;
};
export type Attendance = {
  id: string;
  staff_id: string;
  date: string;
  panchayat: string;
  status: "present" | "leave";
  time_in: string | null;
  time_out: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  photo_path: string | null;
  leave_path: string | null;
  flags: string[];
  profiles?: Profile;
};
