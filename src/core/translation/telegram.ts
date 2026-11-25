import type { Fetch } from './translator';

/**
 * A minimal Telegram Bot API client: send and edit HTML messages, and
 * long-poll for updates. One per bot token.
 */
export interface Telegram {
  /** Sends an HTML message; resolves with its message id. */
  sendMessage(chatId: string, html: string, options?: { replyTo?: number }): Promise<number>;
  /** Replaces a message's text. */
  editMessage(chatId: string, messageId: number, html: string): Promise<void>;
  /** Waits up to `timeoutSeconds` for updates from `offset` on. */
  getUpdates(offset: number, timeoutSeconds: number): Promise<TelegramUpdate[]>;
  /** The bot's own username (without @); checks the token. */
  username(): Promise<string>;
  /** Sends a voice note (OGG/Opus); resolves with its message id. */
  sendVoice(chatId: string, audio: Blob, options?: { replyTo?: number }): Promise<number>;
  /** Downloads a file a message carries (a voice note…), by its `file_id`; at most 20 MB. */
  downloadFile(fileId: string): Promise<Blob>;
}

/** A voice note or audio file in a Telegram message. */
export interface TelegramAudio {
  file_id: string;
  /** In seconds. */
  duration: number;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface TelegramMessage {
  message_id: number;
  chat: { id: number };
  /** When it was sent, in Unix seconds. */
  date?: number;
  text?: string;
  /** A voice note recorded in Telegram. */
  voice?: TelegramAudio;
  /** An audio file. */
  audio?: TelegramAudio;
  /** The message this one replies to (swiped), if any. */
  reply_to_message?: TelegramMessage;
}

/** A Bot API call failed; `status` is the HTTP status (401/404: the token is wrong). */
export class TelegramError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'TelegramError';
    this.status = status;
  }
}

/** Telegram refuses messages longer than this many characters. */
export const telegramMaxLength = 4096;

export function createTelegram(token: string, fetchFn: Fetch = (url, init) => fetch(url, init)): Telegram {
  async function call<T>(method: string, body: Record<string, unknown> | FormData): Promise<T> {
    let response: Response;
    try {
      response = await fetchFn(
        `https://api.telegram.org/bot${token}/${method}`,
        body instanceof FormData
          ? { method: 'POST', body }
          : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      );
    } catch (error) {
      throw new TelegramError(0, `Telegram could not be reached: ${String(error)}`);
    }
    const data = (await response.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
    if (!response.ok || !data.ok) {
      throw new TelegramError(response.status, `Telegram ${method} failed: HTTP ${response.status} ${(data.description ?? '').slice(0, 200)}`);
    }
    return data.result as T;
  }

  return {
    async sendMessage(chatId, html, options = {}) {
      const message = await call<{ message_id: number }>('sendMessage', {
        chat_id: chatId,
        text: html,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...(options.replyTo ? { reply_parameters: { message_id: options.replyTo, allow_sending_without_reply: true } } : {}),
      });
      return message.message_id;
    },
    async editMessage(chatId, messageId, html) {
      try {
        await call('editMessageText', {
          chat_id: chatId,
          message_id: messageId,
          text: html,
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
        });
      } catch (error) {
        // Editing a message to the text it already has is a harmless 400.
        if (!(error instanceof TelegramError && /not modified/i.test(error.message))) throw error;
      }
    },
    getUpdates(offset, timeoutSeconds) {
      return call<TelegramUpdate[]>('getUpdates', { offset, timeout: timeoutSeconds, allowed_updates: ['message'] });
    },
    async username() {
      return (await call<{ username?: string }>('getMe', {})).username ?? '';
    },
    async sendVoice(chatId, audio, options = {}) {
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('voice', audio, 'voice.ogg');
      if (options.replyTo) form.append('reply_parameters', JSON.stringify({ message_id: options.replyTo, allow_sending_without_reply: true }));
      return (await call<{ message_id: number }>('sendVoice', form)).message_id;
    },
    async downloadFile(fileId) {
      const file = await call<{ file_path?: string }>('getFile', { file_id: fileId });
      if (!file.file_path) throw new TelegramError(0, 'Telegram gave no path for the file');
      let response: Response;
      try {
        response = await fetchFn(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
      } catch (error) {
        throw new TelegramError(0, `Telegram could not be reached: ${String(error)}`);
      }
      if (!response.ok) throw new TelegramError(response.status, `Telegram file download failed: HTTP ${response.status}`);
      return response.blob();
    },
  };
}

/** `text` safe to put in a Telegram HTML message. */
export function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
