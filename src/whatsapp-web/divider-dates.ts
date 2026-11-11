import type { LocalDay } from '../core/day-span';
import { PageNotRecognisedError } from '../core/whatsapp-page';

/**
 * Reads the day a WhatsApp Web date divider shows. WhatsApp labels the
 * dividers in the user's local time and language: "Today", "Yesterday", a
 * weekday name for the days before that within the last week, and a numeric
 * date (in the locale's day/month/year order) for anything older.
 *
 * Returns undefined for text that is not a divider label at all (such as an
 * "unread messages" banner). Throws `PageNotRecognisedError` for a numeric
 * label that is not a valid date in the locale's order, since that means the
 * dates cannot be trusted (for example WhatsApp's language differs from the
 * browser's).
 */
export function readDividerDay(label: string, now: Date, locale: string): LocalDay | undefined {
  const text = label.trim().toLocaleLowerCase(locale);
  if (text === '') return undefined;

  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (text === relative.format(0, 'day').toLocaleLowerCase(locale)) return localDay(daysBefore(now, 0));
  if (text === relative.format(-1, 'day').toLocaleLowerCase(locale)) return localDay(daysBefore(now, 1));

  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long' });
  for (let back = 2; back <= 6; back++) {
    const date = daysBefore(now, back);
    if (text === weekday.format(date).toLocaleLowerCase(locale)) return localDay(date);
  }

  const numbers = /^(\d{1,4})\D{1,3}(\d{1,2})\D{1,3}(\d{1,4})$/.exec(text);
  if (!numbers) return undefined;
  const order = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric', year: 'numeric' })
    .formatToParts(new Date(2000, 0, 2))
    .flatMap((part) => (part.type === 'day' || part.type === 'month' || part.type === 'year' ? [part.type] : []));
  const parts: Partial<Record<'day' | 'month' | 'year', number>> = {};
  order.forEach((type, index) => (parts[type] = Number(numbers[index + 1])));
  const { day = 0, month = 0 } = parts;
  let year = parts.year ?? 0;
  if (year < 100) year += 2000;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new PageNotRecognisedError(`the date divider "${label}" is not a date in ${locale}`);
  }
  return localDay(date);
}

function daysBefore(now: Date, days: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
}

function localDay(date: Date): LocalDay {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
