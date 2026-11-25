import { maskId, type DebugLogger } from './debug-log';
import type { LoadedMessage } from './new-messages';
import type { ReportAnswer, SendOutcome, VoiceAudio } from './translation-bot';

/**
 * The Chat Watcher's view of WhatsApp Web: the Chat list, the open Chat's
 * messages and its message box. The real adapter is in `src/whatsapp-web/`.
 */
export interface ChatsPage {
  /** The open Chat's name, or undefined when no Chat is open (or its name can't be read). */
  openChatName(): string | undefined;
  /** The Chat names in the Chat list, as far as WhatsApp Web has rendered it (newest activity first). */
  chatListNames(): string[];
  /**
   * The Chat's row in the Chat list. Undefined when the row is not rendered
   * (WhatsApp Web only renders the rows near the visible ones).
   */
  chatListRow(name: string): ChatListRow | undefined;
  /** Opens the Chat named `name`, from the Chat list or by searching for it; throws if it can't. */
  openChat(name: string): Promise<void>;
  /** Whether the open Chat's message list shows its newest messages (is scrolled to the bottom). */
  atNewest(): boolean;
  /** Expands the newest messages cut short behind "Read more", then reads every loaded message of the open Chat, in page order. */
  readMessages(): Promise<LoadedMessage[]>;
  /** Types `text` into the open Chat's message box and sends it. */
  sendMessage(text: string): Promise<SendOutcome>;
  /**
   * The audio of the open Chat's voice note `messageId`. With `mayPlay`,
   * presses play (muted) when that is the only way to get it.
   */
  voiceAudio(messageId: string, options: { mayPlay: boolean }): Promise<VoiceAudio>;
  /** Calls `callback` whenever the page changes; returns a function that stops. */
  onChange(callback: () => void): () => void;
}

/** What a Chat list row shows. */
export interface ChatListRow {
  /** All its text (name, time, last message). */
  text: string;
  /** Whether it shows an unread badge. */
  unread: boolean;
  /** The number on the unread badge, if it shows one. */
  unreadCount?: number;
  /**
   * The last message, when the row shows it in full as plain text (not a
   * photo, voice note or other media, which show an icon). `sender` is the
   * name a group's row puts before it.
   */
  preview?: ListPreview;
}

export interface ListPreview {
  text: string;
  sender?: string;
}

export interface ChatWatcherOptions {
  page: ChatsPage;
  /** The current settings (read fresh on every check). */
  settings(): Promise<{ enabled: boolean; chatNames: string[] }>;
  /**
   * Hands a Translated Chat's loaded messages to the Translation Bot, which
   * forwards the new ones; it may answer with voice notes whose audio it wants.
   */
  report(chatName: string, messages: LoadedMessage[]): Promise<ReportAnswer | void>;
  /**
   * Whether the open Chat, with these loaded message ids, is the Translated
   * Chat `chatName` (shows a message known from it). Asked before sending:
   * Chats are opened by name, which another Chat can take.
   */
  sameChat(chatName: string, loadedIds: string[]): Promise<boolean>;
  /** Hands the Translation Bot a voice note's audio it asked for (or why it couldn't be had). */
  reportVoice?(chatName: string, messageId: string, audio: VoiceAudio): Promise<void>;
  /**
   * Hands the Translation Bot a new message read from a Chat list row
   * without opening the Chat. `unreadCount` is the row's count with it,
   * which tells the same message seen again from a new one with the same text.
   */
  reportPreview(chatName: string, preview: ListPreview, unreadCount: number): Promise<void>;
  /**
   * Why WhatsApp Web must not be touched right now (a Chat Record is being
   * made), or undefined. While busy, checks do nothing and sends fail.
   */
  busy?(): string | undefined;
  /** How long the page must be quiet after a change before checking. Defaults to 500 ms. */
  debounceMs?: number;
  /** How often to check even without changes (a report may have failed). Defaults to 30 s. */
  intervalMs?: number;
  /** After failing to open a Translated Chat, how long to wait before trying it again. Defaults to 60 s. */
  retryOpenMs?: number;
  now?(): number;
  logError?(error: unknown): void;
  /** Where to note what it does, for the options page's debug log. */
  debug?: DebugLogger;
}

export interface ChatWatcher {
  /** Starts watching the page; returns a function that stops. */
  start(): () => void;
  /** Checks once now (after anything already running). */
  check(): Promise<void>;
  /** Sends `text` to the Chat named `chatName`, switching to it first. */
  send(chatName: string, text: string): Promise<SendOutcome>;
}

/**
 * The Chat Watcher: the WhatsApp Web side of auto-translation, in the
 * content script.
 *
 * While a Translated Chat is open and scrolled to its newest message, it
 * reports the loaded messages to the Translation Bot whenever they change.
 * It also watches every Translated Chat's row in the Chat list, and switches
 * Chats only when it must. When a row's unread count goes up by one and the
 * row shows that message as plain text, the message is handed over from the
 * row, without opening the Chat (so no read receipt either). When it goes up
 * by more, or the message isn't plain text (a photo, a voice note), the Chat
 * is opened and read, and WhatsApp Web stays there. A row that changes
 * without its count going up (the contact typing, a message the user sent
 * from the phone) is left alone, as is a badge that was already there, so
 * badges WhatsApp Web doesn't clear can't make it switch back and forth.
 * One switch per check; the next check takes the next Chat with news.
 *
 * Sending opens the Chat, sends, and goes back to the Chat that was open.
 * Checks and sends run one at a time, in order.
 */
export function createChatWatcher(options: ChatWatcherOptions): ChatWatcher {
  const { page } = options;
  const debounceMs = options.debounceMs ?? 500;
  const intervalMs = options.intervalMs ?? 30_000;
  const retryOpenMs = options.retryOpenMs ?? 60_000;
  const now = options.now ?? (() => Date.now());
  const debug = options.debug ?? (() => {});
  const logError = (error: unknown) => {
    debug('error', { error: errorText(error) });
    (options.logError ?? ((e: unknown) => console.warn('[chat watcher]', e)))(error);
  };
  /** The last state noted in the debug log; a state is noted only when it changes. */
  const lastNoted = new Map<string, string>();
  function note(kind: string, event: string, detail?: Record<string, unknown>) {
    const text = `${event} ${JSON.stringify(detail ?? {})}`;
    if (lastNoted.get(kind) === text) return;
    lastNoted.set(kind, text);
    debug(event, detail);
  }

  /** Each Translated Chat's Chat list row as last seen. */
  const rows = new Map<string, ChatListRow>();
  /** What was last reported per Chat (ids and text lengths), so unchanged messages aren't reported again. */
  const lastReports = new Map<string, string>();
  /** Ids of the messages this watcher sent (from Telegram replies), so they are never forwarded back. */
  const sentHere = new Set<string>();
  /** Chats whose row showed news, until they are opened. */
  const pending = new Set<string>();
  /** When opening each Chat last failed. */
  const openFailedAt = new Map<string, number>();

  let queue: Promise<unknown> = Promise.resolve();
  let checkQueued = false;
  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = queue.then(work);
    queue = run.catch(() => {});
    return run;
  }

  async function checkNow(): Promise<void> {
    if (options.busy?.()) return;
    const { enabled, chatNames } = await options.settings();
    for (const state of [rows, lastReports, openFailedAt, pending]) {
      for (const name of state.keys()) if (!enabled || !chatNames.includes(name)) state.delete(name);
    }
    if (!enabled || chatNames.length === 0) {
      note('state', 'idle', { enabled, translatedChats: chatNames });
      return;
    }

    const open = page.openChatName();
    note('state', 'watching', {
      translatedChats: chatNames,
      openChat: open ?? '(none, or its name could not be read)',
      openIsTranslated: open !== undefined && chatNames.includes(open),
      rowsInChatList: Object.fromEntries(
        chatNames.map((name) => {
          const row = page.chatListRow(name);
          return [name, row ? (row.unread ? 'unread' : 'found') : 'not found'];
        }),
      ),
    });
    // Note which Chats' rows show new messages; every row is read, so each is compared with what it shows now.
    const fromRows: { name: string; preview: ListPreview; count: number }[] = [];
    for (const name of chatNames) {
      const row = page.chatListRow(name);
      if (!row) continue;
      const before = rows.get(name);
      rows.set(name, row);
      if (name === open) continue;
      const count = unreadCount(row);
      const added = count - (before ? unreadCount(before) : 0);
      if (added <= 0) continue; // typing, a message sent from the phone, or a badge that was already there
      if (added === 1 && row.preview) fromRows.push({ name, preview: row.preview, count });
      else pending.add(name);
    }
    if (open) pending.delete(open);
    for (const { name, preview, count } of fromRows) {
      try {
        await options.reportPreview(name, preview, count);
        debug('forwarded from the Chat list, without opening the Chat', { chat: name, unread: count, text: `${preview.text.length} chars` });
      } catch (error) {
        rows.delete(name); // seen as new again next time
        logError(error);
      }
    }
    const withNews = chatNames.filter((name) => pending.has(name));

    if (open && chatNames.includes(open)) await reportOpen(open);
    for (const name of withNews) {
      const failedAt = openFailedAt.get(name);
      if (failedAt !== undefined && now() - failedAt < retryOpenMs) continue;
      try {
        debug('opening a Chat with news', { chat: name });
        await page.openChat(name);
        openFailedAt.delete(name);
        pending.delete(name);
      } catch (error) {
        openFailedAt.set(name, now());
        logError(error);
        continue;
      }
      if (open) lastReports.delete(open);
      await reportOpen(name);
      return; // One switch per check: Chats still pending are opened on the next ones.
    }
  }

  /** Reports the open Chat's messages, if they show its newest messages and changed since the last report. */
  async function reportOpen(chatName: string): Promise<void> {
    // Scrolled up, the newest messages may not be loaded; older ones must not count as new.
    if (!page.atNewest()) {
      note('newest', 'not reporting: the Chat is scrolled up, away from its newest messages', { chat: chatName });
      return;
    }
    lastNoted.delete('newest');
    const messages = (await page.readMessages()).map((message) =>
      sentHere.has(message.id) ? { ...message, sentHere: true } : message,
    );
    const signature = messages.map((message) => `${message.id}:${message.text?.length ?? (message.voice ? 'v' : '-')}`).join(',');
    if (signature === lastReports.get(chatName)) return;
    const newest = messages.slice(-3).map((message) => ({
      id: maskId(message.id),
      direction: message.direction,
      text: message.text === undefined ? (message.voice ? 'voice note' : 'none') : `${message.text.length} chars`,
      ...(message.sentHere ? { sentHere: true } : {}),
    }));
    let answer: ReportAnswer | void;
    try {
      answer = await options.report(chatName, messages);
    } catch (error) {
      debug('report failed', { chat: chatName, error: errorText(error) });
      throw error;
    }
    debug('reported', { chat: chatName, messages: messages.length, newest });
    lastReports.set(chatName, signature);
    // While the Chat is still open: the voice notes the bot wants to hear.
    for (const id of answer?.wantAudio?.ids ?? []) {
      let audio: VoiceAudio;
      try {
        audio = await page.voiceAudio(id, { mayPlay: answer!.wantAudio!.mayPlay });
      } catch (error) {
        audio = { kind: 'failed', detail: errorText(error) };
      }
      debug('voice note audio', {
        chat: chatName,
        id: maskId(id),
        ...(audio.kind === 'audio' ? { bytes: audio.audio.size, played: audio.played } : { failed: audio.detail }),
      });
      await options.reportVoice?.(chatName, id, audio).catch(logError);
    }
  }

  function check(): Promise<void> {
    if (checkQueued) return queue.then(() => {});
    checkQueued = true;
    return enqueue(() => {
      checkQueued = false;
      return checkNow();
    }).catch(logError);
  }

  function send(chatName: string, text: string): Promise<SendOutcome> {
    return enqueue(async (): Promise<SendOutcome> => {
      const busy = options.busy?.();
      if (busy) return { kind: 'failed', detail: busy };
      const previous = page.openChatName();
      try {
        if (previous !== chatName) await page.openChat(chatName);
      } catch (error) {
        return { kind: 'failed', detail: `could not open the Chat in WhatsApp Web (${errorText(error)})` };
      }
      // Messages that came in while the Chat was closed are handed over first, before the reply follows them.
      await reportOpen(chatName).catch(logError);
      let outcome: SendOutcome;
      try {
        const loadedIds = (await page.readMessages()).map((message) => message.id);
        if (!(await options.sameChat(chatName, loadedIds))) {
          outcome = {
            kind: 'failed',
            detail: 'the Chat WhatsApp Web opened under that name shows none of the messages known from it, so it may be another Chat with the same name; nothing was sent',
          };
        } else {
          outcome = await page.sendMessage(text);
        }
      } catch (error) {
        outcome = { kind: 'failed', detail: errorText(error) };
      }
      if (outcome.kind === 'sent' && outcome.id) sentHere.add(outcome.id);
      debug('sent from Telegram', {
        chat: chatName,
        outcome: outcome.kind,
        ...(outcome.kind === 'sent' && outcome.id ? { id: maskId(outcome.id) } : {}),
        ...(outcome.kind === 'failed' ? { detail: outcome.detail } : {}),
      });
      if (outcome.kind !== 'failed') await reportOpen(chatName).catch(logError);
      // Back to where the user was; not worth failing the send over.
      if (previous && previous !== chatName) {
        await page.openChat(previous).catch((error: unknown) => debug('could not go back to the Chat that was open', { error: errorText(error) }));
      }
      return outcome;
    }).finally(() => void check());
  }

  function start(): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stopWatching = page.onChange(() => {
      clearTimeout(timer);
      timer = setTimeout(() => void check(), debounceMs);
    });
    const interval = setInterval(() => void check(), intervalMs);
    void check();
    return () => {
      stopWatching();
      clearTimeout(timer);
      clearInterval(interval);
    };
  }

  return { start, check, send };
}

/** A row's unread count: its badge's number, 1 for a badge without one, 0 without a badge. */
function unreadCount(row: ChatListRow): number {
  return row.unreadCount ?? (row.unread ? 1 : 0);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
