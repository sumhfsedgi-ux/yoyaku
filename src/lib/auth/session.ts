import { cache } from "react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "./options";

export interface StaffSession {
  staffId: string;
  loginEmail: string;
  displayName: string;
  mustChangePassword: boolean;
}

/**
 * A single page render commonly calls requireStaffSession/getStaffSession
 * many times over (once in the admin layout, again in the page itself,
 * again inside every Server Action a Client Component on that page fires) -
 * next-auth's getServerSession() does not dedupe those on its own. Wrapping
 * it in React's cache() is the standard Next.js App Router pattern for this:
 * within one request, every call resolves to the same in-flight/resolved
 * promise instead of re-decoding the JWT cookie each time. This never
 * persists across requests/users - React clears the cache after the request
 * finishes - so it cannot serve stale or cross-user session data.
 */
const getCachedServerSession = cache(() => getServerSession(authOptions));

/** For Server Components, layouts, and Server Actions. Redirects to /login if unauthenticated. */
export async function requireStaffSession(): Promise<StaffSession> {
  const session = await getCachedServerSession();
  if (!session?.staffId) {
    redirect("/login");
  }
  return {
    staffId: session.staffId,
    loginEmail: session.user?.email ?? "",
    displayName: session.user?.name ?? "",
    mustChangePassword: session.mustChangePassword,
  };
}

/** For code paths that only need to know whether someone is logged in, without redirecting. */
export async function getStaffSession(): Promise<StaffSession | null> {
  const session = await getCachedServerSession();
  if (!session?.staffId) return null;
  return {
    staffId: session.staffId,
    loginEmail: session.user?.email ?? "",
    displayName: session.user?.name ?? "",
    mustChangePassword: session.mustChangePassword,
  };
}
