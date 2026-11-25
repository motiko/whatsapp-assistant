import type { ChatsPage } from '../core/translation/chat-watcher';
import type { AudioTap } from './audio-probe';
import { selectors } from './selectors';

/**
 * A description of how WhatsApp Web's page is built around the open Chat,
 * for fixing selectors when the real page doesn't match them. Every text and
 * attribute value is masked (letters become `x`, digits `9`), so it carries
 * no names, numbers or messages; only element types, roles and attribute
 * names show, plus WhatsApp's id prefixes (`true_`/`false_`, `@c.us`…).
 */
export function diagnosePage(doc: Document): Record<string, unknown> {
  const main = doc.querySelector(selectors.conversationPane);
  const report: Record<string, unknown> = {
    url: mask(doc.location?.pathname ?? ''),
    conversationPane: main !== null,
    chatHeader: doc.querySelector(selectors.chatHeader) !== null,
    chatList: doc.querySelector(selectors.chatList) !== null,
    chatListRows: doc.querySelectorAll(`${selectors.chatList} ${selectors.chatListRow}`).length,
    chatListRowsFallback: doc.querySelectorAll(`${selectors.chatList} ${selectors.chatListRowFallback}`).length,
  };
  // One Chat list row with an unread badge (a labelled number), else the first: its masked outline.
  const listRows = Array.from(doc.querySelectorAll(`${selectors.chatList} ${selectors.chatListRow}`));
  const chatRows = listRows.length > 0 ? listRows : Array.from(doc.querySelectorAll(`${selectors.chatList} ${selectors.chatListRowFallback}`));
  const withBadge = chatRows.find((row) =>
    Array.from(row.querySelectorAll(selectors.labelled)).some((element) => /^\d{1,4}$/.test(element.textContent?.trim() ?? '')),
  );
  const sampleRow = withBadge ?? chatRows[0];
  if (sampleRow) {
    report.chatListRowWithBadge = withBadge !== undefined;
    report.chatListRowShape = shape(sampleRow, 0).slice(0, 4000);
  }
  if (!main) return report;
  const ids = Array.from(main.querySelectorAll('[data-id]'), (element) => element.getAttribute('data-id') ?? '');
  Object.assign(report, {
    dataIdCount: ids.length,
    dataIdSamples: ids.slice(-5).map(mask),
    rowCount: main.querySelectorAll('[role="row"]').length,
    listItemCount: main.querySelectorAll('[role="listitem"]').length,
    prePlainTextCount: main.querySelectorAll(selectors.messageBody).length,
    selectableTextCount: main.querySelectorAll(selectors.messageText).length,
    messageInOut: [main.querySelectorAll('.message-in').length, main.querySelectorAll('.message-out').length],
    messageBox: doc.querySelector(selectors.messageBox) !== null,
    sendIcon: doc.querySelector(selectors.sendIcon) !== null,
    footerIcons: Array.from(main.querySelectorAll('footer [data-icon]'), (icon) => icon.getAttribute('data-icon')),
    scrollers: scrollers(main),
  });
  // The last few items of the message list, as a tree of masked tags.
  const rows = Array.from(main.querySelectorAll('[role="row"]'));
  const anchor = rows.at(-1) ?? Array.from(main.querySelectorAll('[data-id]')).at(-1) ?? lastDeepChild(main);
  if (anchor) {
    const item = rows.length > 0 ? anchor : (anchor.parentElement ?? anchor);
    report.lastItemShape = shape(item, 0).slice(0, 6000);
    if (item.parentElement) {
      report.lastItemParents = ancestry(item, main);
    }
  }
  return report;
}

/** Words that describe the page's structure, never what someone wrote: kept unmasked. */
const structuralWords = new Set([
  // WhatsApp id prefixes and domains
  'true', 'false', 'c', 'us', 'g', 'lid', 's', 'whatsapp', 'net', 'broadcast', 'status',
  // roles, directions and other attribute values
  'row', 'listitem', 'list', 'grid', 'gridcell', 'button', 'application', 'textbox', 'region', 'img', 'presentation',
  'dialog', 'navigation', 'main', 'ltr', 'rtl', 'auto', 'none', 'polite', 'off', 'on', 'text', 'plaintext',
]);

/** Letters to `x`, digits to `9`, keeping WhatsApp's id prefixes and structural words. */
function mask(text: string): string {
  return text
    .replace(/\p{L}+/gu, (word) => (structuralWords.has(word) ? word : 'x'))
    .replace(/\d/g, '9');
}

/** Generated class names (WhatsApp's atomic CSS) say nothing; the readable ones do. */
function readableClasses(element: Element): string {
  const value = element.getAttribute('class') ?? '';
  return value
    .split(/\s+/)
    .filter((name) => name && !/^x[a-z0-9]{2,}$/.test(name) && !/^_[a-zA-Z0-9]{3,5}$/.test(name))
    .join(' ');
}

function describe(element: Element): string {
  const attributes = Array.from(element.attributes)
    .filter((attribute) => !['class', 'style', 'src', 'srcset', 'href'].includes(attribute.name))
    .map((attribute) => {
      // Test ids are WhatsApp's own words ("conv-msg-…"); only their id part could be personal.
      const value =
        attribute.name === 'data-testid'
          ? attribute.value.split('-').map((part) => (/^[a-z]{2,16}$/.test(part) ? part : mask(part))).join('-')
          : mask(attribute.value);
      return `${attribute.name}="${value.slice(0, 60)}"`;
    });
  const classes = readableClasses(element);
  if (classes) attributes.push(`class="${classes}"`);
  return `<${element.tagName.toLowerCase()}${attributes.length ? ` ${attributes.join(' ')}` : ''}>`;
}

function shape(element: Element, depth: number): string {
  if (depth > 14) return '';
  const own = `${'  '.repeat(depth)}${describe(element)}${element.children.length === 0 && element.textContent?.trim() ? ` ${mask(element.textContent.trim()).slice(0, 40)}` : ''}\n`;
  return own + Array.from(element.children, (child) => shape(child, depth + 1)).join('');
}

/** The elements from the conversation pane down to `element`. */
function ancestry(element: Element, top: Element): string[] {
  const chain: string[] = [];
  for (let current: Element | null = element.parentElement; current && current !== top; current = current.parentElement) {
    chain.unshift(describe(current));
  }
  return chain;
}

function lastDeepChild(element: Element): Element | undefined {
  let current: Element | null = element.lastElementChild;
  let previous: Element | undefined;
  while (current) {
    previous = current;
    current = current.lastElementChild;
  }
  return previous;
}

function scrollers(main: Element): { height: number; scrollHeight: number; fromBottom: number }[] {
  const view = main.ownerDocument.defaultView!;
  return Array.from(main.querySelectorAll<HTMLElement>('*'))
    .filter((element) => ['auto', 'scroll'].includes(view.getComputedStyle(element).overflowY))
    .map((element) => ({
      height: element.clientHeight,
      scrollHeight: element.scrollHeight,
      fromBottom: Math.round(element.scrollHeight - element.scrollTop - element.clientHeight),
    }));
}

/**
 * How the open Chat's last voice note gives up its audio: plays it (muted)
 * the way auto-translation would, and describes, masked, what the page and
 * the Audio Probe showed before and after. Also the voice note's outline, to
 * fix the voice selectors when none is recognised.
 */
export async function diagnoseVoice(doc: Document, chats: ChatsPage, tap: AudioTap): Promise<Record<string, unknown>> {
  const main = doc.querySelector(selectors.conversationPane);
  if (!main) return { conversationPane: false };
  const report: Record<string, unknown> = {};
  // Messages that look like voice notes by any mark, and the last one's outline.
  const candidates = Array.from(main.querySelectorAll('[data-id]')).filter((message) => message.querySelector(selectors.voiceNote));
  report.voiceCandidates = candidates.length;
  const marks = (message: Element) => ({
    audio: message.querySelectorAll('audio').length,
    icons: Array.from(message.querySelectorAll('[data-icon]'), (icon) => icon.getAttribute('data-icon')),
    sliders: message.querySelectorAll('[role="slider"]').length,
    labelled: Array.from(message.querySelectorAll('[aria-label]'), (element) => mask(element.getAttribute('aria-label') ?? '')).slice(0, 8),
    buttons: message.querySelectorAll('button, [role="button"]').length,
  });
  const lastCandidate = candidates.at(-1);
  if (lastCandidate) {
    report.lastCandidateMarks = marks(lastCandidate);
    report.lastCandidateShape = shape(lastCandidate, 0).slice(0, 6000);
  }
  const media = () =>
    Array.from(doc.querySelectorAll('audio, video, source'), (element) => ({
      tag: element.tagName.toLowerCase(),
      scheme: (element.getAttribute('src') ?? '').split(':')[0] || 'none',
      inMain: main.contains(element),
    }));
  report.probeInstalled = (await tap.state()) !== undefined;
  report.mediaBefore = media();

  let messages;
  try {
    messages = await chats.readMessages();
  } catch (error) {
    report.readMessages = `failed: ${String(error)}`;
    return report;
  }
  const voice = messages.filter((message) => message.voice).at(-1);
  report.voiceNotesRecognised = messages.filter((message) => message.voice).length;
  if (!voice) {
    report.result = 'no voice note recognised in the open Chat (see voiceCandidates and lastCandidateShape)';
    return report;
  }
  report.recognisedVoice = { direction: voice.direction, seconds: voice.voice?.seconds ?? 'unknown' };
  const started = Date.now();
  const result = await chats.voiceAudio(voice.id, { mayPlay: true });
  report.tookMs = Date.now() - started;
  report.result =
    result.kind === 'audio'
      ? { kind: 'audio', played: result.played, bytes: result.audio.size, type: result.audio.type }
      : { kind: 'failed', detail: result.detail };
  report.mediaAfter = media();
  const probe = await tap.state();
  if (probe) {
    report.probe = {
      audioBlobs: probe.audioBlobs.slice(-5),
      mediaSources: probe.mediaSources.slice(-5),
      plays: probe.plays,
      decodeAudioData: probe.decodeAudioData,
      startedSchemes: probe.started,
      now: probe.now,
    };
  }
  return report;
}
