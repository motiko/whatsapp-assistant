/**
 * A span of whole days, each an ISO local date (`YYYY-MM-DD`) in the
 * computer's timezone, the one WhatsApp Web uses for its date dividers.
 * `from` and `to` are both included; they are equal for a single day.
 */
export interface DaySpan {
  from: string;
  to: string;
}

/** The local day (`YYYY-MM-DD`) that `date` falls on. */
export function localDayOf(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "2026-11-04 to 2026-11-11", or just "2026-11-11" for a single day. */
export function formatDaySpan(span: DaySpan): string {
  return span.from === span.to ? span.from : `${span.from} to ${span.to}`;
}
