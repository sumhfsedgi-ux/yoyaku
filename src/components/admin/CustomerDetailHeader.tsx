import { dateToJst } from "@/lib/time/tz";
import type { CustomerDetail } from "@/lib/customers/queries";

function formatYen(amount: number): string {
  return `¥${amount.toLocaleString()}`;
}

export function CustomerDetailHeader({ customer }: { customer: CustomerDetail }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h1 className="mb-1 text-xl font-semibold tracking-tight text-foreground">{customer.name}</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        {customer.email} ・ {customer.phone}
      </p>
      <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">初回来店日</dt>
          <dd className="text-foreground">{customer.firstVisitDate ? dateToJst(customer.firstVisitDate).toFormat("yyyy年M月d日") : "未設定"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">流入経路</dt>
          <dd className="text-foreground">{customer.firstVisitAcquisitionSource?.name ?? "未設定"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">累計来店</dt>
          <dd className="text-foreground">{customer.totalVisits}回</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">累計売上</dt>
          <dd className="text-foreground">{formatYen(customer.totalRevenue)}</dd>
        </div>
      </dl>
    </div>
  );
}
