import { createChatRecorder } from '../core/chat-recorder';
import { copyPngToClipboard } from '../extension/clipboard';
import { downloadFile } from '../extension/download';
import { isOpenPanelRequest } from '../extension/messages';
import { createTabCamera } from '../extension/tab-camera';
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
      createChatRecord(range) {
        if (recording) return Promise.resolve({ kind: 'failed', reason: 'busy', detail: 'a Chat Record is already being made' });
        recording = true;
        const outcome = recorder.record({ kind: 'date-range', from: range.from, to: range.to });
        // Start the clipboard write now, inside the click, with the PNG to follow
        // (a PDF is downloaded instead, and the clipboard is left as it was).
        const copied = copyPngToClipboard(
          outcome.then((o) =>
            o.kind === 'record' && o.record.format === 'png' ? o.record.image : Promise.reject(new Error(o.kind)),
          ),
        );
        return Promise.all([outcome, copied.then(() => undefined, (error: unknown) => error)])
          .then(([o, clipboardError]): CreateResult => {
            if (o.kind === 'failed') return o;
            if (o.kind === 'no-messages') return o;
            const file = { name: o.record.fileName, image: o.record.image };
            if (o.record.format === 'pdf') return { kind: 'made-pdf', file };
            if (clipboardError) return { kind: 'made', file, clipboard: { copied: false, detail: String(clipboardError) } };
            return { kind: 'made', file, clipboard: { copied: true } };
          })
          .finally(() => {
            recording = false;
          });
      },
      download(file) {
        downloadFile(document, file.image, file.name);
      },
    });

    const camera = createTabCamera({ hideOwnUi: () => panel.hide() });
    const recorder = createChatRecorder({ page, camera });

    keepInChatHeader(document, panel.button);
    chrome.runtime.onMessage.addListener((message) => {
      if (isOpenPanelRequest(message)) panel.open();
    });
  },
});
