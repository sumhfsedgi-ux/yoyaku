/**
 * Phase 1 scope guard: LINE notifications (identity acquisition, confirmation
 * push, reminder push, and all LINE-related UI) are enabled for exactly ONE
 * staff member - the one whose own Messaging API/LINE Login/LIFF setup this
 * app is configured against (see plan revision: "腸もみサロン ゆきの" only).
 * Every other staff member continues to work exactly as before this feature
 * existed: normal reservations, normal Gmail, no LINE involvement at all.
 *
 * This is the SINGLE shared check used by every LINE-related server code
 * path - see:
 *  - lib/reservations/service.ts (createReservation: gates whether an
 *    incoming lineIdToken is ever verified/stored at all)
 *  - lib/reservations/lineNotifications.ts (claimAndSendLineNotification:
 *    gates every actual send, confirmation AND reminder, from one place)
 *  - app/api/cron/line-reminders/route.ts (gates the reminder Cron's query
 *    AND re-checks at send time - defense in depth)
 *  - actions/lineBookingPage.ts (tells the /reserve/liff page whether to
 *    attempt LIFF login at all for this staff)
 *  - actions/lineTemplateSettings.ts (gates LINE-related Settings UI/test-send)
 *
 * Deliberately keyed by Staff.id (the stable internal primary key) - NEVER
 * bookingSlug, salonName, or email, none of which are guaranteed stable or
 * unique in the way a database id is.
 *
 * Intentionally an env var, not a DB column: this restriction is a Phase 1
 * scope limitation, not a real product feature to persist/administer - no
 * migration needed, and removing the restriction later (Phase 2, once other
 * staff have their own Messaging API/LINE Login configured) is a pure config
 * change.
 */
export function isLineNotificationEnabledForStaff(staffId: string): boolean {
  const enabledStaffId = process.env.LINE_ENABLED_STAFF_ID;
  return Boolean(enabledStaffId) && staffId === enabledStaffId;
}
