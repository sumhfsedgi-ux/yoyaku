import { listMyCustomers } from "@/actions/customers";
import { CustomerListView } from "@/components/admin/CustomerListView";

export default async function CustomersPage() {
  const customers = await listMyCustomers();

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:px-8 md:py-8">
      <h1 className="mb-6 text-xl font-semibold tracking-tight text-foreground">顧客</h1>
      <CustomerListView customers={customers} />
    </div>
  );
}
