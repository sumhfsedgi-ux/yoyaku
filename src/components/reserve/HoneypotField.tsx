/**
 * Bot honeypot: visually hidden (off-screen positioning, not display:none -
 * some bots skip display:none fields) text input a real customer will never
 * see or fill in. createCustomerReservation() silently no-ops if this arrives
 * non-empty, without telling the caller it was detected (see plan §11 /
 * actions/booking.ts). Field name is deliberately generic-looking.
 */
export function HoneypotField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
      <label htmlFor="website">Website</label>
      <input
        id="website"
        name="website"
        type="text"
        tabIndex={-1}
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
