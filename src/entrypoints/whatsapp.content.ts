import { createChatRecorder } from '../core/chat-recorder';
import { copyPngToClipboard } from '../extension/clipboard';
import { createContinuationStore } from '../extension/continuation-store';
import { downloadFile } from '../extension/download';
import { isOpenPanelRequest } from '../extension/messages';
import { createDebuggerCamera } from '../extension/debugger-camera';
import { createRecordPanel, type CreateResult } from '../ui/record-panel';
import { keepInChatHeader } from '../whatsapp-web/chat-header';
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
    chrome.runtime.onMessage.addListener((message) => {
      if (isOpenPanelRequest(message)) panel.open();
    });
  },
});
