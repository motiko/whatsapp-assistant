import { formatDaySpan, type DaySpan } from './day-span';

/**
 * The file name a Chat Record is saved under:
 * `Chat history - <Chat name> - <from> to <to>.<format>`, with ISO dates and
 * a single date for a single day. Characters no file name may hold are
 * replaced with `_`; emoji and other letters are kept as they are.
 */
export function chatRecordFileName(chatName: string, span: DaySpan, format: 'png' | 'pdf'): string {
  return `Chat history - ${safeChatName(chatName)} - ${formatDaySpan(span)}.${format}`;
}

/** Longest Chat name kept, in UTF-8 bytes, so the whole name fits in 255 bytes. */
const maxChatNameBytes = 150;

function safeChatName(chatName: string): string {
  const safe = chatName
    // Invisible direction marks (common in WhatsApp names): Chrome refuses
    // file names holding them, and they show nothing.
    .replace(/[‎‏‪-‮⁦-⁩﻿]/g, '')
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
