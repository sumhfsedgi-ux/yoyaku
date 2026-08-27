import { SettingsSubNav } from "@/components/admin/SettingsSubNav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <SettingsSubNav />
      {children}
    </div>
  );
}
