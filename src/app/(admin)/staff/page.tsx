import { listStaff } from "@/actions/staff";
import { AddStaffDialog } from "@/components/admin/StaffForm";
import { StaffListItem } from "@/components/admin/StaffListItem";

export default async function StaffPage() {
  const staff = await listStaff();

  return (
    <div className="mx-auto max-w-xl px-4 py-6 md:px-8 md:py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">スタッフ管理</h1>
        <AddStaffDialog />
      </div>
      <div className="flex flex-col gap-2">
        {staff.map((s) => (
          <StaffListItem key={s.id} staff={s} />
        ))}
      </div>
    </div>
  );
}
