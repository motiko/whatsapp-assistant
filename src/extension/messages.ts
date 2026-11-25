/** Messages between the content script and the background worker. */
import type { LoadedMessage } from '../core/translation/new-messages';

/**
 * The name of the port a content script opens for one Chat Record's capture
 * session. The background worker attaches its debugger to the sender's tab
 * while the port is open and detaches when it closes (also when the page
 * goes away), see docs/adr/0004.
 */
export const captureSessionPortName = 'capture-session';

/** Content script → background, over a capture-session port. */
export type CaptureSessionRequest =
  /** Attach to this tab and keep it rendering as if visible; answered with `started` or `start-failed`. */
  | { type: 'start' }
  /** Capture the tab's viewport; answered with `captured` or `capture-failed` with the same `id`. */
  | { type: 'capture'; id: number };

/** Background → content script, over a capture-session port. */
export type CaptureSessionEvent =
  | { type: 'started' }
  | { type: 'start-failed'; error: string }
  /** `dataUrl` is a PNG of the viewport, in device pixels. */
  | { type: 'captured'; id: number; dataUrl: string }
  | { type: 'capture-failed'; id: number; error: string }
  /** Chrome ended the session (the debugger was detached); every later capture fails. */
  | { type: 'ended'; error: string };

/** Background → content script: the user clicked the toolbar icon on this tab. */
export interface OpenPanelRequest {
  type: 'open-panel';
}

export function isOpenPanelRequest(message: unknown): message is OpenPanelRequest {
  return (message as OpenPanelRequest | undefined)?.type === 'open-panel';
}

/*
 * Auto-translation (see src/core/translation/). Answers are given with
 * `sendResponse`.
 */

/**
 * WhatsApp Web content script → background: the Translated Chat's loaded
 * messages; answered `{ ok: true }` plus the bot's `ReportAnswer` (voice notes
 * whose audio it wants).
 */
export interface TranslationReport {
  type: 'translation/report';
  chatName: string;
  messages: LoadedMessage[];
}

/** WhatsApp Web content script → background: a new message read from a Chat list row; answered `{ ok: true }`. */
export interface PreviewReport {
  type: 'translation/preview';
  chatName: string;
  text: string;
  sender?: string;
  unreadCount: number;
}

/** WhatsApp Web content script → background: a voice note's audio the bot asked for; answered `{ ok: true }`. */
export interface VoiceReport {
  type: 'translation/voice';
  chatName: string;
  messageId: string;
  /** The audio, base64 (runtime messages carry JSON only), or why it couldn't be had. */
  audio: { base64: string; mimeType: string; played: boolean } | { failed: string };
}

/**
 * WhatsApp Web content script → background: whether the open Chat is the
 * Translated Chat of that name (shows a message known from it); answered
 * `{ ok: true, same: boolean }`.
 */
export interface SameChatRequest {
  type: 'translation/same-chat';
  chatName: string;
  loadedIds: string[];
}

/** Options page → background: start linking a Telegram chat; answered with the `Pairing`. */
export interface StartPairingRequest {
  type: 'translation/start-pairing';
}

/** Options page → background: settings changed, (re)start the Telegram bot; answered `{ ok: true }`. */
export interface WakeBotRequest {
  type: 'translation/wake';
}

/** Background → WhatsApp Web content script: send `text` to the Chat; answered with a `SendOutcome`. */
export interface SendToChatRequest {
  type: 'translation/send';
  chatName: string;
  text: string;
}

/** Options page → WhatsApp Web content script: answered with a `ChatListAnswer`. */
export interface ChatListRequest {
  type: 'translation/chat-list';
}

export interface ChatListAnswer {
  /** The Chats in the Chat list, as far as WhatsApp Web has rendered it. */
  names: string[];
  /** The open Chat, if any. */
  open?: string;
}

export type ToBackground = TranslationReport | PreviewReport | VoiceReport | SameChatRequest | StartPairingRequest | WakeBotRequest;
/** Options page → WhatsApp Web content script: answered with `diagnosePage`'s masked report. */
export interface DiagnoseRequest {
  type: 'translation/diagnose';
}

/** Options page → WhatsApp Web content script: play the open Chat's last voice note and describe how its audio came; answered with `diagnoseVoice`'s masked report. */
export interface DiagnoseVoiceRequest {
  type: 'translation/diagnose-voice';
}

export type ToWhatsAppTab = SendToChatRequest | ChatListRequest | DiagnoseRequest | DiagnoseVoiceRequest;

const translationTypes = ['translation/report', 'translation/preview', 'translation/voice', 'translation/same-chat', 'translation/start-pairing', 'translation/wake'];
const whatsAppTabTypes = ['translation/send', 'translation/chat-list', 'translation/diagnose', 'translation/diagnose-voice'];

export function isToBackground(message: unknown): message is ToBackground {
  return translationTypes.includes((message as { type?: string } | undefined)?.type ?? '');
}

export function isToWhatsAppTab(message: unknown): message is ToWhatsAppTab {
  return whatsAppTabTypes.includes((message as { type?: string } | undefined)?.type ?? '');
}
