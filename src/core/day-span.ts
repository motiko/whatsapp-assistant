/**
 * A calendar day in the user's local time, as an ISO date (`YYYY-MM-DD`), the
 * way WhatsApp Web's date dividers show it. These strings sort in date order.
 */
export type LocalDay = string;

/**
 * A span of whole local days. `from` and `to` are both included; they are
 * equal for a single day.
 */
export interface DaySpan {
  from: LocalDay;
  to: LocalDay;
}

/** The local day (`YYYY-MM-DD`) that `date` falls on. */
export function localDayOf(date: Date): LocalDay {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "2026-11-04 to 2026-11-11", or just "2026-11-11" for a single day. */
export function formatDaySpan(span: DaySpan): string {
  return span.from === span.to ? span.from : `${span.from} to ${span.to}`;
}
