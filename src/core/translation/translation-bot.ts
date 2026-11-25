import { maskId, type DebugLogger } from './debug-log';
import { languageName, sameLanguage } from './languages';
import type { ListPreview } from './chat-watcher';
import { newIncomingMessages, type LoadedMessage } from './new-messages';
import { sameText } from './text';
import type { Pairing, TranslatedChat, TranslationSettings, TranslationStore } from './store';
import { escapeHtml, type Telegram, type TelegramMessage, type TelegramUpdate } from './telegram';
import { maxVoiceBytes, maxVoiceSeconds, type Transcriber } from './transcriber';
import type { Translator } from './translator';

/** What became of sending a message to a Translated Chat. */
export type SendOutcome =
  /** `id`: the sent message's WhatsApp id, when it was seen in the Chat. */
  | { kind: 'sent'; id?: string }
  /** The message box emptied, but the message did not show up in the Chat in time. */
  | { kind: 'unconfirmed' }
  | { kind: 'failed'; detail: string };

/** The bot's way to WhatsApp Web: a content script in a WhatsApp Web tab. */
export interface WhatsAppLink {
  /** Sends `text` to the Chat named `chatName`, switching WhatsApp Web to it first. */
  send(chatName: string, text: string): Promise<SendOutcome>;
}

export interface TranslationBotDeps {
  store: TranslationStore;
  telegram(token: string): Telegram;
  translator(settings: TranslationSettings): Translator;
  /** The Transcriber the settings name, or undefined when none is set up. */
  transcriber?(settings: TranslationSettings): Transcriber | undefined;
  whatsapp: WhatsAppLink;
  /** Defaults to the clock. */
  now?(): number;
  /** A fresh pairing code. Defaults to 6 random digits. */
  newCode?(): string;
  /** Where errors that reach no one else go. Defaults to the console. */
  logError?(error: unknown): void;
  /** Where to note what it does, for the options page's debug log. */
  debug?: DebugLogger;
}

/**
 * The Translation Bot: the Telegram side of auto-translation.
 *
 * - Incoming messages of the Translated Chats, reported by the Chat Watcher,
 *   are translated into the user's language and sent to the linked Telegram
 *   chat (each at most once), headed with their Chat's name.
 * - Every text the user writes in that Telegram chat is translated into a
 *   Chat's contact language and sent to it straight away; the bot answers
 *   with what was sent and a back-translation. The Chat is the one of the
 *   message the user replied (swiped) to; for a plain message, the Chat that
 *   last wrote or that the user last answered.
 * - Only the linked chat is obeyed. Linking needs proof: the options page
 *   shows a one-time code, and only a chat that sends it is linked.
 */
export interface TranslationBot {
  handleUpdate(update: TelegramUpdate): Promise<void>;
  /**
   * The messages loaded in the Chat named `chatName` (page order); forwards
   * the new incoming ones. A new voice note is forwarded as a status message
   * first: its audio is asked for in the answer, and comes with `reportVoice`.
   */
  reportLoaded(chatName: string, messages: readonly LoadedMessage[]): Promise<ReportAnswer>;
  /** The audio of a voice note `reportLoaded` asked for (or why it couldn't be had): transcribed, translated, forwarded. */
  reportVoice(chatName: string, messageId: string, result: VoiceAudio): Promise<void>;
  /**
   * A new message read from the Chat's row in the Chat list, without opening
   * it; `unreadCount` is the row's count with it. Forwarded once, and not
   * again when the Chat is opened later and its messages are reported.
   */
  reportPreview(chatName: string, preview: ListPreview, unreadCount: number): Promise<void>;
  /** Starts linking a Telegram chat: returns the code to send to the bot. */
  startPairing(): Promise<Pairing>;
}

/** What the bot wants after a report. */
export interface ReportAnswer {
  /** Voice notes (by id) whose audio to send with `reportVoice`; `mayPlay`: whether they may be played to get it. */
  wantAudio?: { ids: string[]; mayPlay: boolean };
}

/** A voice note's audio, as the content script got it. */
export type VoiceAudio =
  /** `played`: it had to be played to get it, so the contact sees it as played. */
  | { kind: 'audio'; audio: Blob; played: boolean }
  | { kind: 'failed'; detail: string };

/** How long a pairing code is valid. */
export const pairingValidMs = 10 * 60_000;
/** Wrong messages from unlinked chats that void a pending pairing code (from all chats together, so no one gets many guesses). */
export const maxPairingFails = 5;
/** A Telegram message sent longer ago than this is marked late when it is finally sent. */
const lateAfterMs = 2 * 60_000;

export function createTranslationBot(deps: TranslationBotDeps): TranslationBot {
  const { store, whatsapp } = deps;
  const now = deps.now ?? (() => Date.now());
  const newCode = deps.newCode ?? randomCode;
  const debug = deps.debug ?? (() => {});
  const logError = (error: unknown) => {
    debug('error', { error: String(error) });
    (deps.logError ?? ((e: unknown) => console.error('[translation bot]', e)))(error);
  };

  /** Serializes read-change-write of stored state (seen ids, linked messages, the pairing code). */
  let lock: Promise<unknown> = Promise.resolve();
  function locked<T>(work: () => Promise<T>): Promise<T> {
    const run = lock.then(work);
    lock = run.catch(() => {});
    return run;
  }

  /** Remembers that Telegram message `messageId` is about `chatName`, for replies to it. */
  const link = (messageId: number, chatName: string) => locked(() => store.linkMessage(messageId, chatName));

  async function handleUpdate(update: TelegramUpdate): Promise<void> {
    const message = update.message;
    if (!message) return;
    const settings = await store.settings();
    if (!settings.telegramToken) return;
    const telegram = deps.telegram(settings.telegramToken);
    const fromChat = String(message.chat.id);
    const text = message.text?.trim() ?? '';
    const voice = message.voice ?? message.audio;

    if (fromChat !== settings.telegramChatId) {
      if (text) await locked(() => tryPair(telegram, fromChat, text));
      return;
    }
    if (!text && !voice) {
      await telegram.sendMessage(fromChat, 'Only text and voice notes can be translated and sent. Send photos in WhatsApp itself.', { replyTo: message.message_id });
      return;
    }
    if (text.startsWith('/')) {
      await command(telegram, fromChat, text, settings);
      return;
    }
    if (settings.chats.length === 0) {
      await telegram.sendMessage(fromChat, '⚠️ Not sent. No Translated Chats are set. Add one in the extension’s options.', { replyTo: message.message_id });
      return;
    }
    if (!settings.enabled) {
      await telegram.sendMessage(fromChat, '⚠️ Not sent. Auto-translation is paused. Send /resume to turn it on.', { replyTo: message.message_id });
      return;
    }
    const chat = await targetChat(message, settings);
    if (!chat) {
      await telegram.sendMessage(
        fromChat,
        '⚠️ Not sent: which Chat is it for? Reply (swipe left) to a message from the Chat you want to answer.',
        { replyTo: message.message_id },
      );
      return;
    }
    const sentAt = message.date ? message.date * 1000 : now();
    if (!voice) {
      await reply(telegram, fromChat, message.message_id, text, chat, settings, now() - sentAt);
      return;
    }
    const transcriber = deps.transcriber?.(settings);
    if (!transcriber) {
      await telegram.sendMessage(
        fromChat,
        '⚠️ Not sent: voice notes need a transcription service. Set one up in the extension’s options, under Voice messages.',
        { replyTo: message.message_id },
      );
      return;
    }
    if (voice.duration > maxVoiceSeconds || (voice.file_size ?? 0) > maxVoiceBytes) {
      await telegram.sendMessage(fromChat, `⚠️ Not sent: voice notes longer than ${maxVoiceSeconds / 60} minutes are not transcribed.`, {
        replyTo: message.message_id,
      });
      return;
    }
    const chatHtml = `<b>${escapeHtml(chat.name)}</b>`;
    const status = await telegram.sendMessage(fromChat, `🎤 <i>Transcribing for ${chatHtml}…</i>`, { replyTo: message.message_id });
    await link(status, chat.name);
    let heard: string;
    try {
      // Telegram serves files untyped; the type tells the Transcriber the format.
      const audio = new Blob([await telegram.downloadFile(voice.file_id)], { type: voice.mime_type ?? 'audio/ogg' });
      heard = (await transcriber.transcribe(audio, { language: settings.myLanguage })).text;
    } catch (error) {
      await telegram.editMessage(fromChat, status, `⚠️ Not sent to ${chatHtml}: the voice note could not be transcribed (${escapeHtml(String(error))}).`);
      return;
    }
    if (!heard) {
      await telegram.editMessage(fromChat, status, `⚠️ Not sent to ${chatHtml}: no words were heard in the voice note.`);
      return;
    }
    debug('voice note from Telegram transcribed', { chat: chat.name, seconds: voice.duration, text: `${heard.length} chars` });
    await reply(telegram, fromChat, message.message_id, heard, chat, settings, now() - sentAt, { status, heard });
  }

  /**
   * The Chat a Telegram message is for: the one of the message it replies to,
   * else the Chat that last wrote or was last answered, else the only Chat.
   */
  async function targetChat(message: TelegramMessage, settings: TranslationSettings): Promise<TranslatedChat | undefined> {
    const find = (name: string | undefined) => settings.chats.find((chat) => chat.name === name);
    const repliedTo = message.reply_to_message?.message_id;
    const ofReply = repliedTo !== undefined ? find(await store.chatOfMessage(repliedTo)) : undefined;
    if (ofReply) return ofReply;
    return find(await store.lastChat()) ?? (settings.chats.length === 1 ? settings.chats[0] : undefined);
  }

  async function reply(
    telegram: Telegram,
    chatId: string,
    messageId: number,
    text: string,
    target: TranslatedChat,
    settings: TranslationSettings,
    delayMs: number,
    /** For a voice note: the status message already sent, and what was heard in it. */
    voice?: { status: number; heard: string },
  ): Promise<void> {
    const chat = `<b>${escapeHtml(target.name)}</b>`;
    // What was heard heads every outcome, so the user can tell a mishearing.
    const heard = voice ? `🎤 <i>“${escapeHtml(voice.heard)}”</i>\n\n` : '';
    // Answer at once, so the user sees the message was received; it becomes the result.
    const waiting = `${heard}⏳ <i>Translating and sending to ${chat}…</i>`;
    let status: number;
    if (voice) {
      status = voice.status;
      await telegram.editMessage(chatId, status, waiting);
    } else {
      status = await telegram.sendMessage(chatId, waiting, { replyTo: messageId });
    }
    // Replying to the bot's answer (also to a failure, to try again) goes to the same Chat.
    await link(status, target.name);
    await store.setLastChat(target.name);
    const translator = deps.translator(settings);
    let translated: string;
    try {
      translated = sameLanguage(settings.myLanguage, target.contactLanguage)
        ? text
        : (await translator.translate(text, settings.myLanguage, target.contactLanguage)).text;
    } catch (error) {
      await telegram.editMessage(chatId, status, `${heard}⚠️ Not sent to ${chat}: the translation failed (${escapeHtml(String(error))}).`);
      return;
    }
    const outgoing = translated;
    let outcome: SendOutcome;
    try {
      outcome = await whatsapp.send(target.name, outgoing);
    } catch (error) {
      outcome = { kind: 'failed', detail: String(error) };
    }
    const late = delayMs > lateAfterMs ? `\n\n<i>Sent ${formatDelay(delayMs)} after you wrote it.</i>` : '';
    if (outcome.kind === 'failed') {
      await telegram.editMessage(chatId, status, `${heard}⚠️ Not sent to ${chat}: ${escapeHtml(outcome.detail)}`);
      return;
    }
    if (outcome.kind === 'unconfirmed') {
      await telegram.editMessage(
        chatId,
        status,
        `${heard}⚠️ Probably sent to ${chat}, but it did not show up in the Chat. Check WhatsApp Web.\n\n${escapeHtml(outgoing)}${late}`,
      );
      return;
    }
    // Never forward what was just sent (it matters in test mode, which forwards the user's own messages).
    const sentId = outcome.id;
    if (sentId) {
      await locked(async () => {
        const seen = await store.seen(target.name);
        if (seen && !seen.includes(sentId)) await store.setSeen(target.name, [...seen, sentId]);
      });
    }
    let back = '';
    if (translated !== text) {
      // Best effort: what the contact will read, in the user's language, from an independent call.
      back = await translator
        .translate(translated, target.contactLanguage, settings.myLanguage)
        .then((result) => `\n\n↩️ <i>${escapeHtml(result.text)}</i>`)
        .catch(() => '');
    }
    await telegram.editMessage(chatId, status, `${heard}✅ Sent to ${chat}:\n${escapeHtml(outgoing)}${back}${late}`);
  }

  async function command(telegram: Telegram, chatId: string, text: string, settings: TranslationSettings): Promise<void> {
    const name = text.split(/\s/)[0]!.toLowerCase().replace(/@.*/, '');
    if (name === '/pause' || name === '/resume') {
      const enabled = name === '/resume';
      if (enabled && settings.chats.length === 0) {
        await telegram.sendMessage(chatId, 'No Translated Chats are set. Add one in the extension’s options first.');
        return;
      }
      await store.updateSettings({ enabled });
      await telegram.sendMessage(chatId, enabled ? '▶️ Auto-translation is on.' : '⏸ Auto-translation is paused. Send /resume to turn it back on.');
      return;
    }
    if (name === '/status') {
      await telegram.sendMessage(chatId, statusText(settings, await store.lastChat()));
      return;
    }
    await telegram.sendMessage(chatId, helpText);
  }

  async function tryPair(telegram: Telegram, fromChat: string, text: string): Promise<void> {
    const pairing = await store.pairing();
    if (!pairing || now() > pairing.until) return;
    const sent = text.replace(/^\/start\s+/i, '').trim();
    if (sent !== pairing.code) {
      const fails = pairing.fails + 1;
      await store.setPairing(fails >= maxPairingFails ? undefined : { ...pairing, fails });
      return;
    }
    await store.setPairing(undefined);
    await store.updateSettings({ telegramChatId: fromChat });
    await telegram.sendMessage(
      fromChat,
      `✅ Linked. Translated messages from WhatsApp arrive here, and whatever you write here is translated and sent back.\n\n${helpText}`,
    );
  }

  /** Why a report about `chatName` is not acted on, or undefined. */
  function ignoredWhy(settings: TranslationSettings, chatName: string): string | undefined {
    const chat = settings.chats.find((candidate) => candidate.name === chatName);
    return !settings.enabled
      ? 'auto-translation is off'
      : !chat
        ? `"${chatName}" is not one of the Translated Chats (${settings.chats.map((c) => `"${c.name}"`).join(', ') || 'none'})`
        : !settings.telegramToken
          ? 'no bot token'
          : !settings.telegramChatId
            ? 'no Telegram chat linked'
            : undefined;
  }

  /** How long a message forwarded from the Chat list is remembered, to recognise it when its Chat is opened. */
  const listForwardKeptMs = 7 * 24 * 60 * 60_000;

  async function reportPreview(chatName: string, preview: ListPreview, unreadCount: number): Promise<void> {
    const settings = await store.settings();
    const ignored = ignoredWhy(settings, chatName);
    if (ignored) {
      debug('Chat list message ignored', { chat: chatName, why: ignored });
      return;
    }
    const entry = { text: preview.text, unreadCount, at: now() };
    const claimed = await locked(async () => {
      const entries = (await store.listForwarded(chatName)).filter((old) => now() - old.at < listForwardKeptMs);
      if (entries.some((old) => sameText(old.text, entry.text) && old.unreadCount === entry.unreadCount)) return false;
      await store.setListForwarded(chatName, [...entries, entry]);
      return true;
    });
    if (!claimed) {
      debug('Chat list message already forwarded', { chat: chatName });
      return;
    }
    const message: LoadedMessage = { id: '(chat list)', direction: 'in', text: preview.text, ...(preview.sender ? { sender: preview.sender } : {}) };
    let forwarded: number;
    try {
      forwarded = await deps.telegram(settings.telegramToken).sendMessage(settings.telegramChatId, await forwardText(message, chatName, settings));
    } catch (error) {
      // Not delivered: forget it, so the row is tried again.
      await locked(async () => {
        const entries = await store.listForwarded(chatName);
        const same = (old: typeof entry) => old.text === entry.text && old.unreadCount === entry.unreadCount && old.at === entry.at;
        await store.setListForwarded(chatName, entries.filter((old) => !same(old)));
      });
      throw error;
    }
    await link(forwarded, chatName);
    await store.setLastChat(chatName);
  }

  async function reportLoaded(chatName: string, messages: readonly LoadedMessage[]): Promise<ReportAnswer> {
    const settings = await store.settings();
    const ignored = ignoredWhy(settings, chatName);
    if (ignored) {
      debug('report ignored', { chat: chatName, why: ignored });
      return {};
    }
    const fresh = await locked(async () => {
      const seen = await store.seen(chatName);
      const loadedIds = messages.map((message) => message.id);
      // An empty list was stored by reports that read no messages (a page the extension couldn't read):
      // it sets nothing aside, so it counts as not seen yet.
      if (!seen || seen.length === 0) {
        // No messages yet usually means WhatsApp Web hasn't drawn them yet: wait for a report that has some,
        // or the history would later look new.
        if (loadedIds.length === 0) {
          debug('first report of this Chat has no messages yet; waiting for one that has', { chat: chatName });
          return [];
        }
        // First sight of this Chat since it was chosen: its history is not forwarded
        // (messages forwarded from the Chat list are part of it now).
        await store.setSeen(chatName, loadedIds);
        await store.setListForwarded(chatName, []);
        debug('first report of this Chat: its messages so far are history, not forwarded', { chat: chatName, messages: loadedIds.length });
        return [];
      }
      const known = new Set(seen);
      const unseen = newIncomingMessages(messages, known, { includeOwn: settings.forwardOwnMessages });
      // Messages already forwarded from the Chat list, now seen in the Chat: each matches one of them, oldest first.
      const listed = await store.listForwarded(chatName);
      const fresh = unseen.filter((message) => {
        const match = message.direction === 'in' && message.text !== undefined ? listed.findIndex((entry) => sameText(entry.text, message.text!)) : -1;
        if (match === -1) return true;
        listed.splice(match, 1);
        return false;
      });
      if (fresh.length !== unseen.length) await store.setListForwarded(chatName, listed);
      await store.setSeen(chatName, [...seen, ...loadedIds.filter((id) => !known.has(id))]);
      debug('report', {
        chat: chatName,
        loaded: messages.length,
        alreadySeen: loadedIds.filter((id) => known.has(id)).length,
        toForward: fresh.map((message) => maskId(message.id)),
        testMode: settings.forwardOwnMessages,
      });
      return fresh;
    });
    const telegram = deps.telegram(settings.telegramToken);
    // Voice notes' audio is wanted when it can be transcribed or is to be forwarded.
    const audioWanted = deps.transcriber?.(settings) !== undefined || settings.voice.forwardAudio;
    const wantAudio: string[] = [];
    for (const [index, message] of fresh.entries()) {
      let forwarded: number;
      try {
        const html = message.voice ? voiceStatusText(message, chatName, audioWanted) : await forwardText(message, chatName, settings);
        forwarded = await telegram.sendMessage(settings.telegramChatId, html);
      } catch (error) {
        // Not delivered: forget this message and the ones after it, so the next report tries again.
        const unsent = new Set(fresh.slice(index).map((m) => m.id));
        await locked(async () => {
          const seen = (await store.seen(chatName)) ?? [];
          await store.setSeen(chatName, seen.filter((id) => !unsent.has(id)));
        });
        logError(error);
        return wantAudio.length > 0 ? { wantAudio: { ids: wantAudio, mayPlay: settings.voice.playIfNeeded } } : {};
      }
      await link(forwarded, chatName);
      await store.setLastChat(chatName);
      debug('forwarded to Telegram', { chat: chatName, id: maskId(message.id), ...(message.voice ? { voice: true } : {}) });
      if (message.voice && audioWanted) {
        // Short voice notes are only transcribed right with their language given: without it, every model tried
        // heard a 7-second Hebrew “test 1 2 3” as Arabic, Persian or made-up English. The Chat's language, for
        // the user's own too (test mode): the Chat's setting is the more specific one.
        const language = settings.chats.find((chat) => chat.name === chatName)?.contactLanguage ?? settings.myLanguage;
        const pending = {
          telegramId: forwarded,
          header: headerOf(message, chatName),
          at: now(),
          ...(message.voice.seconds !== undefined ? { seconds: message.voice.seconds } : {}),
          ...(language ? { language } : {}),
        };
        await locked(() => store.setPendingVoice(chatName, message.id, pending));
        wantAudio.push(message.id);
      }
    }
    return wantAudio.length > 0 ? { wantAudio: { ids: wantAudio, mayPlay: settings.voice.playIfNeeded } } : {};
  }

  /** The first status of a voice note: what it is, and (if its audio is wanted) that it is on its way. */
  function voiceStatusText(message: LoadedMessage, chatName: string, audioWanted: boolean): string {
    const what = `🎤 Voice note${message.voice?.seconds !== undefined ? ` ${formatSeconds(message.voice.seconds)}` : ''}`;
    return audioWanted
      ? `${headerOf(message, chatName)}\n${what} <i>— transcribing…</i>`
      : `${headerOf(message, chatName)}\n${what}. <i>To read it here, set up transcription in the extension’s options, under Voice messages. Open WhatsApp to hear it.</i>`;
  }

  async function reportVoice(chatName: string, messageId: string, result: VoiceAudio): Promise<void> {
    const settings = await store.settings();
    const pending = await locked(async () => {
      const found = await store.pendingVoice(chatName, messageId);
      if (found) await store.setPendingVoice(chatName, messageId, undefined);
      return found;
    });
    if (!pending) {
      debug('voice note audio not asked for, ignored', { chat: chatName, id: maskId(messageId) });
      return;
    }
    if (!settings.telegramToken || !settings.telegramChatId) return;
    const telegram = deps.telegram(settings.telegramToken);
    const what = `🎤 Voice note${pending.seconds !== undefined ? ` ${formatSeconds(pending.seconds)}` : ''}`;
    const edit = (body: string) => telegram.editMessage(settings.telegramChatId, pending.telegramId, `${pending.header}\n${body}`);
    if (result.kind === 'failed') {
      debug('voice note audio not had', { chat: chatName, id: maskId(messageId), detail: result.detail });
      await edit(`${what}. <i>Its audio could not be had (${escapeHtml(result.detail)}). Open WhatsApp to hear it.</i>`);
      return;
    }
    debug('voice note audio had', {
      chat: chatName,
      id: maskId(messageId),
      bytes: result.audio.size,
      type: result.audio.type || '(none)',
      played: result.played,
      ...(pending.language ? { language: pending.language } : {}),
    });
    if (settings.voice.forwardAudio) {
      try {
        const sent = await telegram.sendVoice(settings.telegramChatId, result.audio, { replyTo: pending.telegramId });
        await link(sent, chatName);
      } catch (error) {
        logError(error);
      }
    }
    const transcriber = deps.transcriber?.(settings);
    if (!transcriber) {
      await edit(`${what}${settings.voice.forwardAudio ? ', below' : ''}. <i>Set up transcription in the extension’s options to read it here.</i>`);
      return;
    }
    if (result.audio.size > maxVoiceBytes || (pending.seconds ?? 0) > maxVoiceSeconds) {
      await edit(`${what}. <i>Too long to transcribe (over ${maxVoiceSeconds / 60} minutes). Open WhatsApp to hear it.</i>`);
      return;
    }
    let heard: string;
    try {
      heard = (await transcriber.transcribe(result.audio, pending.language ? { language: pending.language } : {})).text;
    } catch (error) {
      await edit(`${what}. ⚠️ <i>Not transcribed: ${escapeHtml(String(error))}. Open WhatsApp to hear it.</i>`);
      return;
    }
    if (!heard) {
      await edit(`${what}. <i>No words were heard in it.</i>`);
      return;
    }
    await edit(`🎤 ${await translatedBody(heard, settings)}`);
  }

  /** A forwarded message's first line: its Chat, and who sent it. */
  function headerOf(message: LoadedMessage, chatName: string): string {
    const from =
      message.direction === 'out'
        ? ' · you (test mode)'
        : message.sender && message.sender !== chatName
          ? ` · ${escapeHtml(message.sender)}`
          : '';
    return `💬 <b>${escapeHtml(chatName)}</b>${from}`;
  }

  async function forwardText(message: LoadedMessage, chatName: string, settings: TranslationSettings): Promise<string> {
    const header = headerOf(message, chatName);
    if (message.text === undefined || message.text.trim() === '') {
      return `${header}\n📎 <i>A message without text (a photo, sticker…). Open WhatsApp to see it.</i>`;
    }
    return `${header}\n${await translatedBody(message.text, settings)}`;
  }

  /** `text` in the user's language (Telegram HTML), with the original below if the settings say so. */
  async function translatedBody(text: string, settings: TranslationSettings): Promise<string> {
    const original = clip(text);
    try {
      const translation = await deps.translator(settings).translate(text, 'auto', settings.myLanguage);
      const alreadyMine =
        (translation.detected !== undefined && sameLanguage(translation.detected, settings.myLanguage)) ||
        translation.text.trim() === text.trim();
      if (alreadyMine) return escapeHtml(original);
      const below = settings.showOriginal ? `\n\n<i>${escapeHtml(original)}</i>` : '';
      return `${escapeHtml(clip(translation.text))}${below}`;
    } catch (error) {
      return `${escapeHtml(original)}\n\n⚠️ <i>Not translated: ${escapeHtml(String(error))}</i>`;
    }
  }

  async function startPairing(): Promise<Pairing> {
    return locked(async () => {
      const pairing: Pairing = { code: newCode(), until: now() + pairingValidMs, fails: 0 };
      await store.setPairing(pairing);
      return pairing;
    });
  }

  return { handleUpdate, reportLoaded, reportVoice, reportPreview, startPairing };
}

const helpText = [
  '<b>WhatsApp translation</b>',
  '',
  '• New messages in the Translated Chats arrive here, translated into your language, under the Chat’s name.',
  '• To answer, reply (swipe left) to a message from that Chat and write in your language: it is translated and sent right away.',
  '• A message that isn’t a reply goes to the Chat that last wrote, or that you last answered. The bot always says where it went.',
  '• /pause stops both ways, /resume starts again, /status shows the settings.',
].join('\n');

function statusText(settings: TranslationSettings, lastChat: string | undefined): string {
  const chats = settings.chats.map(
    (chat) => `• ${escapeHtml(chat.name)} (${escapeHtml(languageName(chat.contactLanguage))})${chat.name === lastChat ? ' ← plain messages go here' : ''}`,
  );
  return [
    `<b>Auto-translation is ${settings.enabled ? 'on' : 'paused'}</b>`,
    `Your language: ${escapeHtml(languageName(settings.myLanguage))}`,
    `Translator: ${settings.translator === 'llm' ? `LLM (${escapeHtml(settings.llm.model)})` : 'Google Translate'}`,
    '',
    chats.length ? 'Translated Chats:' : 'No Translated Chats yet.',
    ...chats,
  ].join('\n');
}

/** Keeps a forwarded message (translation and original together) under Telegram's length limit. */
function clip(text: string): string {
  const max = 1800;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function formatDelay(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** `83` → `1:23`. */
export function formatSeconds(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function randomCode(): string {
  const value = crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000;
  return String(value).padStart(6, '0');
}
