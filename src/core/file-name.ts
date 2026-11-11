import { formatDaySpan, type DaySpan } from './day-span';

/**
 * The file name a Chat Record is saved under:
 * `Chat history - <Chat name> - <from> to <to>.<format>`, with ISO dates and
 * a single date for a single day, and ` (partial)` or ` (gap)` before the
 * extension for a Partial Chat Record or a Gap Record. Characters no file
 * name may hold are replaced with `_`; emoji and other letters are kept as
 * they are.
 */
export function chatRecordFileName(
  chatName: string,
  span: DaySpan,
  format: 'png' | 'pdf',
  mark?: 'partial' | 'gap',
): string {
  const suffix = mark ? ` (${mark})` : '';
  return `Chat history - ${safeChatName(chatName)} - ${formatDaySpan(span)}${suffix}.${format}`;
}

/** Longest Chat name kept, in UTF-8 bytes, so the whole name fits in 255 bytes. */
const maxChatNameBytes = 150;

function safeChatName(chatName: string): string {
  const safe = chatName
    // Invisible format characters: direction marks (common in WhatsApp
    // names) and the joiners inside emoji such as 👨‍👩‍👧. Chrome turns each
    // into "_" when it saves a download; without them, the emoji remain.
    .replace(/\p{Cf}/gu, '')
    // Line breaks and tabs become spaces.
    .replace(/[\t\n\r]+/g, ' ')
    // Not allowed in file names on Windows, macOS or Linux, or by Chrome.
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    // A leading dot would hide the file; a trailing one is dropped by Windows.
    .replace(/^\.+|\.+$/g, '');
  return truncate(safe) || 'Unnamed Chat';
}

/** Cuts `text` to at most `maxChatNameBytes`, between whole characters (emoji included). */
function truncate(text: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= maxChatNameBytes) return text;
  const ellipsis = '…';
  let kept = '';
  for (const { segment } of new Intl.Segmenter().segment(text)) {
    if (encoder.encode(kept + segment + ellipsis).length > maxChatNameBytes) break;
    kept += segment;
  }
  return kept.trimEnd() + ellipsis;
}
