import * as holidayJp from "@holiday-jp/holiday_jp";

/**
 * `@holiday-jp/holiday_jp` ships as an `export =` module, so it must be
 * imported as a namespace, not a named import. `isHoliday` accepts a
 * "YYYY-MM-DD" string directly (its internal dataset is keyed by that exact
 * format) - passing the string instead of a Date sidesteps `format()`'s use
 * of the JS Date object's LOCAL-timezone getters, which could misclassify
 * the date by a day for a browser not set to JST.
 */
export function isJpHoliday(dateISO: string): boolean {
  return holidayJp.isHoliday(dateISO);
}
