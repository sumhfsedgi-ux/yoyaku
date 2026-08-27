/**
 * Authorization guards enforced server-side, never trusting client-side
 * hiding. See plan §10 for the full permission model:
 *  - Reservation/Customer PII: owning staff only (assertOwnsReservation).
 *  - A staff member's own schedule/cutoff/window settings: self only
 *    (assertOwnsStaffSettings).
 *  - A staff member's own login credentials: self only, and there is no
 *    "target staff id" parameter anywhere in the credentials-update path -
 *    see actions/security.ts - so "change someone else's password" is not an
 *    API call that can even be constructed, not just one that gets rejected.
 *  - Staff roster management (add/rename/activate/deactivate) and manual
 *    reservation creation for any staff: shared among all staff, not
 *    restricted by these guards.
 *  - Customer chart data (Customer/VisitRecord/ConcernMaster/
 *    AcquisitionSourceMaster): strictly self-only, same as Reservation -
 *    assertOwnsCustomer / assertOwnsVisitRecord.
 */
export class ForbiddenError extends Error {
  constructor(message = "この操作を行う権限がありません") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export function assertOwnsReservation(staffId: string, reservation: { staffId: string }): void {
  if (reservation.staffId !== staffId) {
    throw new ForbiddenError();
  }
}

export function assertOwnsStaffSettings(staffId: string, targetStaffId: string): void {
  if (staffId !== targetStaffId) {
    throw new ForbiddenError();
  }
}

export function assertOwnsCustomer(staffId: string, customer: { ownerStaffId: string }): void {
  if (customer.ownerStaffId !== staffId) {
    throw new ForbiddenError();
  }
}

export function assertOwnsVisitRecord(staffId: string, visitRecord: { staffId: string }): void {
  if (visitRecord.staffId !== staffId) {
    throw new ForbiddenError();
  }
}

export function assertOwnsRetailSale(staffId: string, retailSale: { staffId: string }): void {
  if (retailSale.staffId !== staffId) {
    throw new ForbiddenError();
  }
}
