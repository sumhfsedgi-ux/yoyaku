import Link from "next/link";
import { notFound } from "next/navigation";
import { getMyCustomerDetail } from "@/actions/customers";
import { listMyAcquisitionSources, listMyConcernMasters } from "@/actions/masters";
import { ForbiddenError } from "@/lib/auth/authorization";
import { CustomerDetailHeader } from "@/components/admin/CustomerDetailHeader";
import { CustomerFirstVisitEditForm } from "@/components/admin/CustomerFirstVisitEditForm";
import { VisitRecordList } from "@/components/admin/VisitRecordList";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/lib/ui/interactionStyles";

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [detailResult, allConcernMasters, acquisitionSourceMasters] = await Promise.all([
    getMyCustomerDetail(id).then(
      (value) => ({ ok: true as const, value }),
      (err: unknown) => ({ ok: false as const, err }),
    ),
    listMyConcernMasters(),
    listMyAcquisitionSources(),
  ]);

  if (!detailResult.ok) {
    const err = detailResult.err;
    if (err instanceof ForbiddenError) notFound();
    if (err instanceof Error && err.message === "NOT_FOUND") notFound();
    throw err;
  }
  const customer = detailResult.value;
  const isFirstVisit = customer.firstVisitDate === null;
  const activeAcquisitionSources = acquisitionSourceMasters.filter((s) => s.active);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
      <Link
        href="/customers"
        className={cn(
          "-ml-2 w-fit self-start rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition-all hover:bg-muted/40 hover:text-foreground active:scale-[0.97] active:bg-muted/60",
          FOCUS_RING,
        )}
      >
        ← 顧客一覧に戻る
      </Link>
      <CustomerDetailHeader customer={customer} />
      <CustomerFirstVisitEditForm
        customerId={customer.id}
        firstVisitDate={customer.firstVisitDate}
        firstVisitAcquisitionSourceId={customer.firstVisitAcquisitionSource?.id ?? null}
        acquisitionSourceOptions={acquisitionSourceMasters}
      />
      <VisitRecordList
        customerId={customer.id}
        visitRecords={customer.visitRecords}
        allConcernMasters={allConcernMasters}
        acquisitionSourceOptions={activeAcquisitionSources}
        isFirstVisit={isFirstVisit}
      />
    </div>
  );
}
