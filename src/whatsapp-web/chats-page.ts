import type { ChatListRow, ChatsPage, ListPreview } from '../core/translation/chat-watcher';
import type { LoadedMessage } from '../core/translation/new-messages';
import type { SendOutcome, VoiceAudio } from '../core/translation/translation-bot';
import type { AudioTap } from './audio-probe';
import { cleanText } from '../core/translation/text';
import { PageNotRecognisedError } from '../core/whatsapp-page';
import { selectors } from './selectors';
import { createWhatsAppWebPage, messageScroller } from './whatsapp-web-page';

export interface ChatsPageOptions {
  /** How long to wait for a Chat to open after clicking it. Defaults to 10 s. */
  openWaitMs?: number;
  /** How long to wait for a sent message to show up in the Chat. Defaults to 15 s. */
  sendWaitMs?: number;
  /** How long to wait for "Read more" to show the rest of a message. Defaults to 2 s. */
  readMoreWaitMs?: number;
  /** How long to wait for typed text to show in the message box (its editor applies it a moment later). Defaults to 3 s. */
  typeWaitMs?: number;
  /** The way to the voice notes' audio, in the page's world; without it, voice notes' audio can't be had. */
  audioTap?: AudioTap;
  /** How long to wait for a voice note's audio after pressing play (it may be downloaded first). Defaults to 20 s. */
  voiceWaitMs?: number;
}

/** Within this many CSS px of the bottom, the message list counts as showing its newest messages. */
const newestSlackPx = 120;
/** "Read more" is expanded only in this many of the newest messages. */
const readMoreNewest = 20;

/**
 * The real Chats Page: WhatsApp Web's Chat list, the open Chat's messages and
 * its message box. Its waits watch the page for changes rather than poll on
 * timers, because Chrome slows timers in a background tab to once a second
 * (and, after some minutes hidden, to once a minute) and runs no animation
 * frames there.
 */
export function createChatsPage(doc: Document, options: ChatsPageOptions = {}): ChatsPage {
  const openWaitMs = options.openWaitMs ?? 10_000;
  const sendWaitMs = options.sendWaitMs ?? 15_000;
  const readMoreWaitMs = options.readMoreWaitMs ?? 2_000;
  const typeWaitMs = options.typeWaitMs ?? 3_000;
  const voiceWaitMs = options.voiceWaitMs ?? 20_000;
  const boxText = () => squash(doc.querySelector(selectors.messageBox)?.textContent ?? '');
  const recordPage = createWhatsAppWebPage(doc);

  const openChatName = () => {
    try {
      return recordPage.chatName();
    } catch {
      return undefined;
    }
  };

  return {
    openChatName,
    chatListNames() {
      return chatListRows(doc)
        .map(rowName)
        .filter((name): name is string => name !== undefined);
    },
    chatListRow(name) {
      const named = chatListRows(doc).filter((row) => rowName(row) === name);
      // Two Chats of that name: which one's message it is can't be told.
      const row = named.length === 1 ? named[0] : undefined;
      return row ? readRow(row) : undefined;
    },
    async openChat(name) {
      if (openChatName() === name) return;
      let row = findRow(doc, name);
      let searched = false;
      if (!row) {
        // Not rendered in the Chat list (too far down): search for it.
        const search = doc.querySelector<HTMLElement>(selectors.chatSearch);
        if (!search) throw new PageNotRecognisedError(`the Chat "${name}" is not in the Chat list, and the search box (${selectors.chatSearch}) is missing`);
        replaceText(doc, search, name);
        searched = true;
        await waitUntil(doc, () => findRow(doc, name) !== undefined, openWaitMs);
        row = findRow(doc, name);
        if (!row) {
          replaceText(doc, search, '');
          throw new Error(`no Chat named "${name}" in WhatsApp Web`);
        }
      }
      try {
        refuseIfAmbiguous(doc, name);
      } catch (error) {
        if (searched) {
          const search = doc.querySelector<HTMLElement>(selectors.chatSearch);
          if (search) replaceText(doc, search, '');
        }
        throw error;
      }
      clickLikeAUser(row.querySelector(selectors.chatListTitle) ?? row);
      const opened = await waitUntil(doc, () => openChatName() === name, openWaitMs);
      if (searched) {
        const search = doc.querySelector<HTMLElement>(selectors.chatSearch);
        if (search) replaceText(doc, search, '');
      }
      if (!opened) throw new Error(`clicked the Chat "${name}", but WhatsApp Web did not open it`);
    },
    atNewest() {
      const scroller = messageScroller(doc);
      return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= newestSlackPx;
    },
    async readMessages() {
      const buttons = messageElements(doc)
        .slice(-readMoreNewest)
        .flatMap((message) => Array.from(message.querySelectorAll<HTMLElement>(selectors.readMore)));
      if (buttons.length > 0) {
        for (const button of buttons) button.click();
        await waitUntil(doc, () => buttons.every((button) => !button.isConnected), readMoreWaitMs);
      }
      return messageElements(doc).map(readMessage);
    },
    async sendMessage(text) {
      const box = doc.querySelector<HTMLElement>(selectors.messageBox);
      if (!box) return { kind: 'failed', detail: `the message box (${selectors.messageBox}) is missing` };
      if (squash(box.textContent ?? '') !== '') {
        return { kind: 'failed', detail: 'the message box in WhatsApp Web already has unsent text in it' };
      }
      const before = new Set(outgoingIds(doc));
      typeInto(doc, box, text);
      // WhatsApp Web's editor applies typed text a moment later, not during the input event.
      if (!(await waitUntil(doc, () => boxText() === squash(text), typeWaitMs))) {
        const shown = boxText().length;
        replaceText(doc, box, '');
        await waitUntil(doc, () => boxText() === '', typeWaitMs);
        return {
          kind: 'failed',
          detail: `could not type into the message box (it showed ${shown} of ${squash(text).length} characters)`,
        };
      }
      // The send button appears only once the box holds text.
      const sendButton =
        doc.querySelector(selectors.sendIcon)?.closest<HTMLElement>('button, [role="button"]') ??
        doc.querySelector<HTMLElement>(selectors.sendButton);
      if (sendButton) clickLikeAUser(sendButton);
      else pressEnter(doc.querySelector<HTMLElement>(selectors.messageBox) ?? box);
      const shown = await waitUntil(doc, () => outgoingIds(doc).some((id) => !before.has(id)), sendWaitMs);
      const id = outgoingIds(doc).find((outgoing) => !before.has(outgoing));
      if (shown && id) return { kind: 'sent', id } satisfies SendOutcome;
      const current = doc.querySelector(selectors.messageBox);
      if (current && squash(current.textContent ?? '') !== '') {
        return { kind: 'failed', detail: 'WhatsApp Web did not send it; it is still in the message box' };
      }
      return { kind: 'unconfirmed' };
    },
    async voiceAudio(messageId, { mayPlay }): Promise<VoiceAudio> {
      const tap = options.audioTap;
      if (!tap) return { kind: 'failed', detail: 'the extension can’t reach WhatsApp Web’s audio here' };
      const message = messageElements(doc).find((element) => element.getAttribute('data-id') === messageId);
      if (!message) return { kind: 'failed', detail: 'the voice note is no longer shown in WhatsApp Web' };
      // Already given its audio (played before, by the user or WhatsApp Web): no need to play it.
      const element = Array.from(message.querySelectorAll(selectors.voiceAudioElement)).find((found) => !insideQuote(found, message));
      const ready = element?.getAttribute('src');
      if (ready) return { kind: 'audio', audio: await tap.fetch(ready), played: false };
      if (!mayPlay) {
        return { kind: 'failed', detail: 'its audio is only had by playing it, and playing voice notes is turned off in the options' };
      }
      const button = playButton(message);
      if (!button) return { kind: 'failed', detail: 'its play button was not found' };
      const since = await tap.arm();
      let url: string | undefined;
      try {
        clickLikeAUser(button);
        url = await tap.audioSince(since, voiceWaitMs);
      } finally {
        await tap.disarm();
      }
      if (!url) return { kind: 'failed', detail: 'pressing play gave no audio in time' };
      return { kind: 'audio', audio: await tap.fetch(url), played: true };
    },
    onChange(callback) {
      const observer = new MutationObserver(callback);
      observer.observe(doc.body, { childList: true, subtree: true, characterData: true });
      return () => observer.disconnect();
    },
  };
}

function chatListRows(doc: Document): Element[] {
  const list = doc.querySelector(selectors.chatList);
  if (!list) return [];
  const rows = list.querySelectorAll(selectors.chatListRow);
  return Array.from(rows.length > 0 ? rows : list.querySelectorAll(selectors.chatListRowFallback));
}

/** What a Chat list row shows: its text, unread badge and count, and its last message when it is plain text. */
export function readRow(row: Element): ChatListRow {
  const badge = unreadBadge(row);
  const count = badge ? Number.parseInt((badge.textContent ?? '').replace(/\D/g, ''), 10) : Number.NaN;
  const preview = readPreview(row, badge);
  return {
    text: row.textContent?.trim() ?? '',
    unread: badge !== undefined,
    ...(Number.isFinite(count) && count > 0 ? { unreadCount: count } : {}),
    ...(preview ? { preview } : {}),
  };
}

/** The unread badge: by its English label, or in any language a labelled element whose text is a number. */
function unreadBadge(row: Element): Element | undefined {
  const english = row.querySelector(selectors.unreadBadge);
  if (english) return english;
  return Array.from(row.querySelectorAll(selectors.labelled)).find((element) =>
    /^\d{1,4}$/.test(element.textContent?.trim() ?? ''),
  );
}

/**
 * The row's last message, if it shows it as plain text: the last element
 * with a `title` other than the Chat's name holds it in full (the row may
 * cut it short on screen). Not plain text when an icon stands next to it on
 * its line (a photo, voice note…). In a group, the line starts "Name: ".
 */
function readPreview(row: Element, badge: Element | undefined): ListPreview | undefined {
  const titled = Array.from(row.querySelectorAll(selectors.chatListTitle));
  const nameElement = titled[0];
  const last = titled.length > 1 ? titled.at(-1)! : undefined;
  const text = cleanText(last?.getAttribute('title') ?? '');
  if (!nameElement || !last || !text) return undefined;
  // The preview's line: its outermost ancestor that doesn't also hold the Chat's name.
  let line: Element = last;
  while (line.parentElement && line.parentElement !== row && !line.parentElement.contains(nameElement)) line = line.parentElement;
  const icon = Array.from(line.querySelectorAll(selectors.rowIcon)).some(
    (element) => !last.contains(element) && !(badge?.contains(element) ?? false),
  );
  if (icon) return undefined;
  const lineText = cleanText((line.textContent ?? '').replace(badge?.textContent ?? '\u0000', ''));
  const shown = cleanText(last.textContent ?? '');
  // The line shows the text (maybe cut short) after the sender's name: what comes before it.
  const before = shown && lineText.endsWith(shown) ? lineText.slice(0, -shown.length).trim() : lineText.endsWith(text) ? lineText.slice(0, -text.length).trim() : '';
  const sender = /^(.+?):$/.exec(before)?.[1]?.trim();
  return sender ? { text, sender } : { text };
}

function rowName(row: Element): string | undefined {
  return row.querySelector(selectors.chatListTitle)?.getAttribute('title')?.trim() || undefined;
}

function findRow(doc: Document, name: string): Element | undefined {
  return chatListRows(doc).find((row) => rowName(row) === name);
}

/**
 * Chats are known by name only, so two with the same name (a group renamed
 * like a contact, say) can't be told apart: then neither is read or written to.
 */
function refuseIfAmbiguous(doc: Document, name: string): void {
  if (chatListRows(doc).filter((row) => rowName(row) === name).length > 1) {
    throw new Error(`more than one Chat in WhatsApp Web is named "${name}"; rename one, so messages can't go to the wrong Chat`);
  }
}

/** The open Chat's messages, in page order (messages quoted inside others left out). */
function messageElements(doc: Document): Element[] {
  const pane = doc.querySelector(selectors.conversationPane);
  if (!pane) throw new PageNotRecognisedError(`the conversation pane (${selectors.conversationPane}) is missing`);
  return Array.from(pane.querySelectorAll(selectors.message)).filter(
    (element) => (element.getAttribute('data-id') ?? '') !== '' && !element.parentElement?.closest(selectors.message),
  );
}

function outgoingIds(doc: Document): string[] {
  return messageElements(doc)
    .filter((element) => messageDirection(element) === 'out')
    .map((element) => element.getAttribute('data-id') ?? '');
}

/**
 * Who sent a message: from its id or class where WhatsApp Web still says,
 * else from where its bubble sits. The user's own bubbles sit at the end of
 * the line (right in a left-to-right page, left in a right-to-left one),
 * everyone else's at the start. Undecidable (not laid out) counts as `in`.
 */
export function messageDirection(element: Element): 'in' | 'out' {
  const id = element.getAttribute('data-id') ?? '';
  if (id.startsWith(selectors.ownIdPrefix)) return 'out';
  if (id.startsWith(selectors.othersIdPrefix)) return 'in';
  if (element.closest(selectors.ownMessageClass) || element.querySelector(selectors.ownMessageClass)) return 'out';
  if (element.closest(selectors.othersMessageClass) || element.querySelector(selectors.othersMessageClass)) return 'in';
  const side = bubbleSide(element);
  if (!side) return 'in';
  const rtl = element.ownerDocument.defaultView?.getComputedStyle(element).direction === 'rtl';
  return (side === 'right') !== rtl ? 'out' : 'in';
}

/**
 * Which side of the message's row its bubble sits on. The bubble is the
 * largest box inside the row that is clearly narrower than the row (it holds
 * everything else of the message, so small things beside it, such as a
 * reaction or a selection checkbox, can't be taken for it), compared by its
 * gaps to the row's edges.
 */
function bubbleSide(element: Element): 'left' | 'right' | undefined {
  const row = element.getBoundingClientRect();
  if (row.width === 0) return undefined;
  let bubble: DOMRect | undefined;
  for (const candidate of element.querySelectorAll('*')) {
    const box = candidate.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0 || box.width >= row.width * 0.9) continue;
    if (!bubble || box.width * box.height > bubble.width * bubble.height) bubble = box;
  }
  if (!bubble) return undefined;
  const leftGap = bubble.left - row.left;
  const rightGap = row.right - bubble.right;
  if (Math.abs(leftGap - rightGap) < 4) return undefined; // centred: a date chip or a system notice
  return rightGap < leftGap ? 'right' : 'left';
}

function readMessage(element: Element): LoadedMessage {
  const id = element.getAttribute('data-id')!;
  const direction = messageDirection(element);
  const body = ownBody(element);
  const label = body?.getAttribute('data-pre-plain-text') ?? '';
  const sender = /^\[[^\]]*\]\s*(.+?):\s*$/.exec(label)?.[1];
  const textElement = body ? ownText(element, body) : undefined;
  const text = textElement ? cleanText(readText(textElement)) : '';
  const voice = !text ? readVoice(element) : undefined;
  return { id, direction, ...(sender ? { sender } : {}), ...(text ? { text } : {}), ...(voice ? { voice } : {}) };
}

/**
 * Whether a message is a voice note, and its length: of the times it shows
 * ("0:23", then the time it was sent, "14:05"), the first, when there are two.
 */
function readVoice(message: Element): { seconds?: number } | undefined {
  const own = (selector: string) => Array.from(message.querySelectorAll(selector)).filter((found) => !insideQuote(found, message));
  if (own(selectors.voiceNoteStrong).length === 0) return undefined;
  const times = Array.from(message.querySelectorAll('*'))
    .filter((element) => element.children.length === 0 && !insideQuote(element, message))
    .map((element) => /^(\d{1,2}):(\d{2})$/.exec(cleanText(element.textContent ?? '')))
    .filter((match): match is RegExpExecArray => match !== null);
  const length = times.length >= 2 ? times[0]! : undefined;
  return length ? { seconds: Number(length[1]) * 60 + Number(length[2]) } : {};
}

/** A voice note's play button: by its icon, else by its (English) label. */
function playButton(message: Element): HTMLElement | undefined {
  const outsideQuote = (found: Element) => !insideQuote(found, message);
  const icon = Array.from(message.querySelectorAll(selectors.voicePlayIcon)).find(outsideQuote);
  const byIcon = icon?.closest<HTMLElement>('button, [role="button"]') ?? (icon as HTMLElement | undefined);
  return byIcon ?? (Array.from(message.querySelectorAll<HTMLElement>(selectors.voicePlayButton)).find(outsideQuote) ?? undefined);
}

/**
 * Whether `node` is inside the quote of a message the reply `message`
 * answers: a quote holds a message's text. Other buttons in a message (a
 * voice note's play button, the time and ticks) aren't quotes.
 */
function insideQuote(node: Element, message: Element): boolean {
  for (let quote = node.closest(selectors.quotedMessage); quote && quote !== message && message.contains(quote); quote = quote.parentElement?.closest(selectors.quotedMessage) ?? null) {
    if (quote.matches(selectors.quotedText) || quote.querySelector(selectors.quotedText)) return true;
  }
  return false;
}

/**
 * The message's own body (with its sender line), not a quoted message's:
 * the outermost one outside any quote, the last if there are several.
 */
function ownBody(message: Element): Element | undefined {
  const bodies = Array.from(message.querySelectorAll(selectors.messageBody)).filter((body) => !insideQuote(body, message));
  const outermost = bodies.filter((body) => !bodies.some((other) => other !== body && other.contains(body)));
  return outermost.at(-1) ?? message.querySelector(selectors.messageBody) ?? undefined;
}

/** The message's own text element in `body`: not the quote's, the last if there are several. */
function ownText(message: Element, body: Element): Element | undefined {
  const own = Array.from(body.querySelectorAll(selectors.messageText)).filter(
    (text) => !insideQuote(text, message) && text.closest(selectors.messageBody) === body,
  );
  return own.at(-1) ?? body.querySelector(selectors.messageText) ?? undefined;
}

/** An element's text as the user sees it: emoji images by their `alt`, line breaks as newlines, no "Read more". */
function readText(element: Element): string {
  let text = '';
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? '';
      continue;
    }
    // By node type, not `instanceof`: the page's nodes may come from another frame.
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const child = node as Element;
    if (child.matches(selectors.readMore)) continue;
    if (child.tagName === 'IMG') text += child.getAttribute('alt') ?? '';
    else if (child.tagName === 'BR') text += '\n';
    else text += readText(child);
  }
  return text;
}

/** Text without any whitespace, to compare what was typed with what was meant (line breaks differ). */
function squash(text: string): string {
  return text.replace(/[\s​-‍﻿]+/g, '');
}

/**
 * Types `text` into a contenteditable the way the browser does for a user,
 * so WhatsApp Web's editor sees the input events it expects. Lines are
 * joined with line breaks (Shift+Enter), not paragraphs (Enter sends).
 */
function typeInto(doc: Document, box: HTMLElement, text: string): void {
  box.focus();
  text.split('\n').forEach((line, index) => {
    if (index > 0) doc.execCommand('insertLineBreak');
    if (line) doc.execCommand('insertText', false, line);
  });
}

/** Replaces everything in a contenteditable (`''` empties it). */
function replaceText(doc: Document, box: HTMLElement, text: string): void {
  box.focus();
  doc.execCommand('selectAll');
  if (text) doc.execCommand('insertText', false, text);
  else doc.execCommand('delete');
}

/** WhatsApp Web reacts to the mouse buttons going down and up, not only to `click`. */
function clickLikeAUser(element: Element): void {
  const view = element.ownerDocument.defaultView;
  for (const type of ['mousedown', 'mouseup', 'click']) {
    element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view, button: 0 }));
  }
}

function pressEnter(box: HTMLElement): void {
  box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
}

/**
 * Resolves true as soon as `condition` holds, checking after every change to
 * the page, or false after `waitMs`. A single timer, so a background tab's
 * timer throttling only delays the timeout, never a change that happened.
 */
function waitUntil(doc: Document, condition: () => boolean, waitMs: number): Promise<boolean> {
  if (condition()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const view = doc.defaultView!;
    const finish = (result: boolean) => {
      observer.disconnect();
      view.clearTimeout(timer);
      resolve(result);
    };
    const observer = new MutationObserver(() => {
      if (condition()) finish(true);
    });
    observer.observe(doc.documentElement, { childList: true, subtree: true, characterData: true, attributes: true });
    const timer = view.setTimeout(() => finish(condition()), waitMs);
  });
}
