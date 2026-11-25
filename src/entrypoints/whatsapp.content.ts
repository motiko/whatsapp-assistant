import { createChatRecorder } from '../core/chat-recorder';
import { copyPngToClipboard } from '../extension/clipboard';
import { createContinuationStore } from '../extension/continuation-store';
import { downloadFile } from '../extension/download';
import { createChatWatcher } from '../core/translation/chat-watcher';
import { createDebugLog } from '../core/translation/debug-log';
import { createTranslationStore, defaultSettings, settingsStorageKey } from '../core/translation/store';

declare const __BUILD_ID__: string;
import {
  isOpenPanelRequest,
  isToWhatsAppTab,
  type ChatListAnswer,
  type PreviewReport,
  type TranslationReport,
  type VoiceReport,
  type SameChatRequest,
} from '../extension/messages';
import type { ReportAnswer } from '../core/translation/translation-bot';
import { createAudioTap } from '../whatsapp-web/audio-probe';
import { createDebuggerCamera } from '../extension/debugger-camera';
import { createRecordPanel, type CreateResult } from '../ui/record-panel';
import { keepInChatHeader } from '../whatsapp-web/chat-header';
import { createChatsPage } from '../whatsapp-web/chats-page';
import { diagnosePage, diagnoseVoice } from '../whatsapp-web/diagnose';
import { createWhatsAppWebPage } from '../whatsapp-web/whatsapp-web-page';

export default defineContentScript({
  matches: ['https://web.whatsapp.com/*'],
  main() {
    const page = createWhatsAppWebPage(document);
    let recording = false;

    const panel = createRecordPanel(document, {
      chatName() {
        try {
          return page.chatName();
        } catch {
          return undefined;
        }
      },
      createChatRecord(request, run) {
        // The recorder refuses a second run too; this also keeps a second clipboard write from starting.
        if (recording) return Promise.resolve({ kind: 'failed', reason: 'busy', detail: 'a Chat Record is already being made' });
        recording = true;
        const outcome = recorder.record(request, run);
        // Start the clipboard write now, inside the click, with the PNG to follow
        // (a PDF is downloaded instead, and the clipboard is left as it was).
        // A Partial Chat Record is copied (or downloaded) like any other.
        const copied = copyPngToClipboard(
          outcome.then((o) =>
            (o.kind === 'record' || o.kind === 'partial') && o.record.format === 'png'
              ? o.record.image
              : Promise.reject(new Error(o.kind)),
          ),
        );
        return Promise.all([outcome, copied.then(() => undefined, (error: unknown) => error)])
          .then(([o, clipboardError]): CreateResult => {
            if (o.kind === 'failed') return o;
            if (o.kind === 'no-messages' || o.kind === 'empty-chat' || o.kind === 'cancelled') return o;
            const file = { name: o.record.fileName, image: o.record.image };
            const extras = {
              ...(o.kind === 'partial'
                ? { partial: { continuation: o.continuation, reason: o.reason, detail: o.detail } }
                : {}),
              ...(o.gap
                ? {
                    gap:
                      o.gap.kind === 'record'
                        ? { kind: 'record' as const, file: { name: o.gap.record.fileName, image: o.gap.record.image } }
                        : { kind: 'failed' as const, detail: o.gap.detail },
                  }
                : {}),
            };
            if (o.record.format === 'pdf') return { kind: 'made-pdf', file, ...extras };
            if (clipboardError) {
              return { kind: 'made', file, clipboard: { copied: false, detail: String(clipboardError) }, ...extras };
            }
            return { kind: 'made', file, clipboard: { copied: true }, ...extras };
          })
          .finally(() => {
            recording = false;
          });
      },
      download(file) {
        downloadFile(document, file.image, file.name);
      },
      continuations: createContinuationStore(),
    });

    // Captures also while the tab is in the background (see docs/adr/0004).
    const camera = createDebuggerCamera({ hideOwnUi: () => panel.hide() });
    const recorder = createChatRecorder({ page, camera });

    keepInChatHeader(document, panel.button);

    // Auto-translation: watch the Translated Chats and send the Translation Bot's replies (see src/core/translation/).
    const audioTap = createAudioTap(window);
    const chats = createChatsPage(document, { audioTap });
    const store = createTranslationStore(chrome.storage.local);
    let settings = Promise.resolve({ enabled: false, chatNames: [] as string[] });
    const loadSettings = () => {
      settings = store
        .settings()
        .catch(() => defaultSettings)
        .then((loaded) => ({ enabled: loaded.enabled, chatNames: loaded.chats.map((chat) => chat.name) }));
    };
    loadSettings();
    const debug = createDebugLog(chrome.storage.local, 'whatsapp');
    debug('WhatsApp Web page started', { build: __BUILD_ID__ });
    const watcher = createChatWatcher({
      debug,
      page: chats,
      settings: () => settings,
      async report(chatName, messages) {
        const report: TranslationReport = { type: 'translation/report', chatName, messages };
        const answer = (await chrome.runtime.sendMessage(report)) as ({ ok?: boolean; error?: string } & ReportAnswer) | undefined;
        if (!answer?.ok) throw new Error(`the Translation Bot did not take the messages: ${answer?.error ?? 'no answer'}`);
        return answer.wantAudio ? { wantAudio: answer.wantAudio } : {};
      },
      async reportVoice(chatName, messageId, audio) {
        const report: VoiceReport = {
          type: 'translation/voice',
          chatName,
          messageId,
          audio:
            audio.kind === 'audio'
              ? { base64: await toBase64(audio.audio), mimeType: audio.audio.type || 'audio/ogg', played: audio.played }
              : { failed: audio.detail },
        };
        const answer = (await chrome.runtime.sendMessage(report)) as { ok?: boolean; error?: string } | undefined;
        if (!answer?.ok) throw new Error(`the Translation Bot did not take the voice note: ${answer?.error ?? 'no answer'}`);
      },
      async sameChat(chatName, loadedIds) {
        const request: SameChatRequest = { type: 'translation/same-chat', chatName, loadedIds };
        const answer = (await chrome.runtime.sendMessage(request)) as { ok?: boolean; same?: boolean; error?: string } | undefined;
        if (!answer?.ok) throw new Error(`the Translation Bot did not answer: ${answer?.error ?? 'no answer'}`);
        return answer.same === true;
      },
      async reportPreview(chatName, preview, unreadCount) {
        const report: PreviewReport = { type: 'translation/preview', chatName, ...preview, unreadCount };
        const answer = (await chrome.runtime.sendMessage(report)) as { ok?: boolean; error?: string } | undefined;
        if (!answer?.ok) throw new Error(`the Translation Bot did not take the message: ${answer?.error ?? 'no answer'}`);
      },
      // Switching Chats in the middle of a Chat Record would spoil it.
      busy: () => (recording ? 'a Chat Record is being made in WhatsApp Web; send it again when it is done' : undefined),
    });
    watcher.start();
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !(settingsStorageKey in changes)) return;
      loadSettings();
      void watcher.check();
    });

    chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
      if (isOpenPanelRequest(message)) panel.open();
      if (!isToWhatsAppTab(message)) return false;
      if (message.type === 'translation/send') {
        void watcher.send(message.chatName, message.text).then(sendResponse);
        return true; // answered asynchronously
      }
      if (message.type === 'translation/diagnose-voice') {
        void diagnoseVoice(document, chats, audioTap)
          .then((report) => ({ build: __BUILD_ID__, ...report }))
          .catch((error: unknown) => ({ failed: String(error) }))
          .then(sendResponse);
        return true; // answered asynchronously
      }
      if (message.type === 'translation/diagnose') {
        void chats
          .readMessages()
          .then(
            (messages) => ({
              messagesRead: messages.length,
              atNewest: safely(() => chats.atNewest()),
              newestAsRead: messages.slice(-6).map((message) => ({
                direction: message.direction,
                sender: message.sender ? 'yes' : 'no',
                text: message.text === undefined ? 'none' : `${message.text.length} chars`,
              })),
            }),
            (error: unknown) => ({ messagesRead: `failed: ${String(error)}` }),
          )
          .then((adapter) =>
            sendResponse({
              build: __BUILD_ID__,
              openChat: chats.openChatName() !== undefined,
              ...adapter,
              // What the extension reads from the first Chat list rows (by position, no names).
              chatListAsRead: chats
                .chatListNames()
                .slice(0, 10)
                .map((name, index) => {
                  const row = chats.chatListRow(name);
                  return {
                    row: index + 1,
                    unread: row?.unread ?? false,
                    unreadCount: row?.unreadCount ?? 'none',
                    lastMessage: row?.preview
                      ? `${row.preview.text.length} chars${row.preview.sender ? ', with sender' : ''}`
                      : 'not plain text (or not found): the Chat would be opened',
                  };
                }),
              ...diagnosePage(document),
            }),
          );
        return true; // answered asynchronously
      }
      const open = chats.openChatName();
      const answer: ChatListAnswer = { names: chats.chatListNames(), ...(open ? { open } : {}) };
      sendResponse(answer);
      return false;
    });
  },
});

/** A blob's bytes as base64, for a runtime message (JSON only). */
async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function safely<T>(read: () => T): T | string {
  try {
    return read();
  } catch (error) {
    return `failed: ${String(error)}`;
  }
}
