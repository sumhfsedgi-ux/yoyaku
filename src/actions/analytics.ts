"use server";

import { requireStaffSession } from "@/lib/auth/session";
import { getAllTimeAnalytics, getMonthlyAnalytics } from "@/lib/analytics/queries";

export async function getMyMonthlyAnalytics(year: number, month: number) {
  const session = await requireStaffSession();
  return getMonthlyAnalytics(year, month, session.staffId);
}

export async function getMyAllTimeAnalytics() {
  const session = await requireStaffSession();
  return getAllTimeAnalytics(session.staffId);
}
