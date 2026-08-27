import Link from "next/link";
import { DateTime } from "luxon";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { listMyRetailSales, listMyRetailProductSuggestions } from "@/actions/retail";
import { nowJst } from "@/lib/time/tz";
import { Button } from "@/components/ui/button";
import { RetailSaleList } from "@/components/admin/retail/RetailSaleList";

export default async function RetailPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const params = await searchParams;
  const current = params.month ? DateTime.fromFormat(params.month, "yyyy-MM") : nowJst().startOf("month");
  const year = current.year;
  const month = current.month;

  const [sales, productSuggestions] = await Promise.all([listMyRetailSales(year, month), listMyRetailProductSuggestions()]);

  const todayISO = nowJst().toISODate()!;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
      <div>
        <h1 className="mb-4 text-xl font-semibold tracking-tight text-foreground">小売実績</h1>
        <p className="mb-4 text-sm text-muted-foreground">自分が登録した小売実績の登録・確認・修正を行います。</p>
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="icon-touch"
            render={<Link href={`/retail?month=${current.minus({ months: 1 }).toFormat("yyyy-MM")}`} aria-label="前の月" />}
          >
            <ChevronLeftIcon />
          </Button>
          <p className="text-sm font-medium text-foreground">{current.toFormat("yyyy年M月")}</p>
          <Button
            variant="outline"
            size="icon-touch"
            render={<Link href={`/retail?month=${current.plus({ months: 1 }).toFormat("yyyy-MM")}`} aria-label="次の月" />}
          >
            <ChevronRightIcon />
          </Button>
        </div>
      </div>

      <RetailSaleList sales={sales} productSuggestions={productSuggestions} defaultSoldAtISO={todayISO} />
    </div>
  );
}
