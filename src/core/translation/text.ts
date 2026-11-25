/**
 * Characters that format text without showing: zero-width spaces and
 * joiners' neighbours, and the bidirectional marks and embeddings WhatsApp
 * Web wraps text in (more so around right-to-left text). The Chat list's
 * copy of a message carries some the open Chat's copy doesn't.
 * (U+200D, the zero-width joiner, is kept: it holds emoji like 👨‍👩‍👧 together.)
 */
const invisible = /[​‌‎‏‪-‮⁦-⁩﻿]/g;

/** Text without invisible formatting characters, its whitespace runs as single spaces (line breaks kept), trimmed. */
export function cleanText(text: string): string {
  return text
    .replace(invisible, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

/** Whether two copies of a message (from the Chat list and from the open Chat) are the same text. */
export function sameText(a: string, b: string): boolean {
  return cleanText(a).replace(/\s+/g, ' ') === cleanText(b).replace(/\s+/g, ' ');
}
