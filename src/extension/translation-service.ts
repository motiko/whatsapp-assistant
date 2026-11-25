import type { LoadedMessage } from '../core/translation/new-messages';
import { createTranslationStore, type TranslationSettings } from '../core/translation/store';
import { createTelegram, TelegramError } from '../core/translation/telegram';
import { createTranslationBot, type SendOutcome, type WhatsAppLink } from '../core/translation/translation-bot';
import { createGoogleTranslator, createLlmTranslator, type Translator } from '../core/translation/translator';
import { createOpenAiTranscriber, transcriberConfigured, type Transcriber } from '../core/translation/transcriber';
import { createDebugLog } from '../core/translation/debug-log';
import { isToBackground, type SendToChatRequest, type ToBackground } from './messages';

declare const __BUILD_ID__: string;

const whatsAppWeb = 'https://web.whatsapp.com/';
const pollAlarm = 'translation-bot';
/** Seconds Telegram holds a `getUpdates` call open waiting for updates. */
const pollSeconds = 25;
/** Where the background notes how the bot is doing, for the options page. */
export const botStatusKey = 'translation.botStatus';

/** How the Telegram bot is doing, as the options page shows it. */
export interface BotStatus {
  /** When the last `getUpdates` returned, in ms since the epoch. */
  lastPollAt?: number;
  /** Why polling stopped or failed last, if it did. */
  error?: string;
}

/** The translator the settings ask for. */
export function translatorFor(settings: TranslationSettings): Translator {
  return settings.translator === 'llm' ? createLlmTranslator(settings.llm) : createGoogleTranslator();
}

/** The Transcriber the settings name, or undefined when none is set up. */
export function transcriberFor(settings: TranslationSettings): Transcriber | undefined {
  return transcriberConfigured(settings.transcriber) ? createOpenAiTranscriber(settings.transcriber) : undefined;
}

/**
 * The background worker's side of auto-translation: runs the Translation
 * Bot, long-polls Telegram for the user's messages, and reaches WhatsApp Web
 * through its content script.
 *
 * The MV3 worker is stopped when idle; every poll's storage write keeps it
 * alive while the bot runs, and a one-minute alarm (plus every report from
 * WhatsApp Web) restarts the loop after Chrome stopped the worker.
 */
export function serveTranslation(): void {
  const store = createTranslationStore(chrome.storage.local);
  const debug = createDebugLog(chrome.storage.local, 'bot');
  debug('background started', { build: __BUILD_ID__ });
  const bot = createTranslationBot({
    store,
    telegram: (token) => createTelegram(token),
    translator: translatorFor,
    transcriber: transcriberFor,
    whatsapp: whatsAppLink(),
    debug,
  });

  let polling = false;
  async function pollLoop(): Promise<void> {
    if (polling) return;
    polling = true;
    try {
      for (;;) {
        const { telegramToken } = await store.settings();
        if (!telegramToken) return;
        let updates;
        try {
          updates = await createTelegram(telegramToken).getUpdates(await store.offset(), pollSeconds);
        } catch (error) {
          await setStatus({ error: String(error) });
          // A wrong token won't get better by retrying; the options page wakes the loop on a new one.
          if (error instanceof TelegramError && (error.status === 401 || error.status === 404)) return;
          // A network blip, or 409: another program polls this bot (one consumer per bot).
          await new Promise((resolve) => setTimeout(resolve, 5000));
          continue;
        }
        await setStatus({ lastPollAt: Date.now() });
        // One at a time, in order: replies must reach WhatsApp in the order they were written.
        for (const update of updates) {
          // Advance first: a crash must never send the same reply twice.
          await store.setOffset(update.update_id + 1);
          await bot.handleUpdate(update).catch((error: unknown) => console.error('[translation bot] update failed', error));
        }
      }
    } finally {
      polling = false;
    }
  }

  const setStatus = (status: BotStatus) => chrome.storage.local.set({ [botStatusKey]: status });

  void chrome.alarms.create(pollAlarm, { periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === pollAlarm) void pollLoop();
  });
  void pollLoop();

  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (!isToBackground(message)) return false;
    void handle(message, sender).then(sendResponse, (error: unknown) => sendResponse({ ok: false, error: String(error) }));
    return true; // answered asynchronously
  });

  async function handle(message: ToBackground, sender: chrome.runtime.MessageSender): Promise<unknown> {
    void pollLoop();
    switch (message.type) {
      case 'translation/report': {
        if (sender.frameId !== 0 || !sender.url?.startsWith(whatsAppWeb)) return { ok: false, error: 'not from WhatsApp Web' };
        return { ok: true, ...(await bot.reportLoaded(message.chatName, readMessages(message.messages))) };
      }
      case 'translation/voice': {
        if (sender.frameId !== 0 || !sender.url?.startsWith(whatsAppWeb)) return { ok: false, error: 'not from WhatsApp Web' };
        if (typeof message.chatName !== 'string' || typeof message.messageId !== 'string' || typeof message.audio !== 'object') {
          return { ok: false, error: 'malformed' };
        }
        const audio = message.audio;
        await bot.reportVoice(
          message.chatName,
          message.messageId,
          'base64' in audio && typeof audio.base64 === 'string'
            ? { kind: 'audio', audio: fromBase64(audio.base64, String(audio.mimeType || 'audio/ogg')), played: audio.played === true }
            : { kind: 'failed', detail: 'failed' in audio ? String(audio.failed) : 'no audio' },
        );
        return { ok: true };
      }
      case 'translation/preview': {
        if (sender.frameId !== 0 || !sender.url?.startsWith(whatsAppWeb)) return { ok: false, error: 'not from WhatsApp Web' };
        if (typeof message.chatName !== 'string' || typeof message.text !== 'string' || !message.text.trim()) {
          return { ok: false, error: 'malformed' };
        }
        const unreadCount = typeof message.unreadCount === 'number' ? message.unreadCount : 1;
        await bot.reportPreview(
          message.chatName,
          { text: message.text.trim(), ...(typeof message.sender === 'string' && message.sender ? { sender: message.sender } : {}) },
          unreadCount,
        );
        return { ok: true };
      }
      case 'translation/start-pairing':
        // An extension page, by its URL: the options page opens in a tab, so `sender.tab` doesn't tell.
        if (!sender.url?.startsWith(chrome.runtime.getURL(''))) {
          return { ok: false, error: 'only the options page can link a chat' };
        }
        return bot.startPairing();
      case 'translation/wake':
        return { ok: true };
    }
  }
}

/** The bot reaches WhatsApp Web through the content script of the most recently used WhatsApp Web tab. */
function whatsAppLink(): WhatsAppLink {
  return {
    async send(chatName, text) {
      const tabs = await chrome.tabs.query({ url: `${whatsAppWeb}*` });
      if (tabs.length === 0) return { kind: 'failed', detail: 'WhatsApp Web is not open in Chrome' };
      tabs.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
      const request: SendToChatRequest = { type: 'translation/send', chatName, text };
      for (const tab of tabs) {
        if (tab.id === undefined) continue;
        try {
          const outcome = (await chrome.tabs.sendMessage(tab.id, request, { frameId: 0 })) as SendOutcome | undefined;
          if (outcome) return outcome;
        } catch {
          // No content script in this tab (opened before the extension was loaded): try the next one.
        }
      }
      return { kind: 'failed', detail: 'WhatsApp Web did not answer; reload its tab' };
    },
  };
}

/** Messages from a content script, keeping only well-formed ones and only their known fields. */
function readMessages(messages: unknown): LoadedMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages.flatMap((value): LoadedMessage[] => {
    const message = value as Partial<LoadedMessage> | undefined;
    if (typeof message?.id !== 'string' || (message.direction !== 'in' && message.direction !== 'out')) return [];
    return [
      {
        id: message.id,
        direction: message.direction,
        ...(typeof message.sender === 'string' ? { sender: message.sender } : {}),
        ...(typeof message.text === 'string' ? { text: message.text } : {}),
        ...(message.sentHere === true ? { sentHere: true } : {}),
        ...(typeof message.voice === 'object' && message.voice !== null
          ? { voice: typeof message.voice.seconds === 'number' ? { seconds: message.voice.seconds } : {} }
          : {}),
      },
    ];
  });
}

function fromBase64(base64: string, mimeType: string): Blob {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: mimeType });
}
