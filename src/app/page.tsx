import { redirect } from "next/navigation";

/** No public landing page in this system - staff land on /login, customers arrive via their own /reserve/{slug} link. */
export default function Home() {
  redirect("/login");
}
