import type { Camera } from '../core/camera';
import { createChatRecorder } from '../core/chat-recorder';
import { copyPngToClipboard } from '../extension/clipboard';
import { downloadFile } from '../extension/download';
import { isOpenPanelRequest } from '../extension/messages';
import { createTabCamera } from '../extension/tab-camera';
import { whileTabVisible } from '../extension/visible-tab-camera';
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
      createChatRecord(range, run) {
        // The recorder refuses a second run too; this also keeps a second clipboard write from starting.
        if (recording) return Promise.resolve({ kind: 'failed', reason: 'busy', detail: 'a Chat Record is already being made' });
        recording = true;
        // Hiding the tab part-way fails the Chat Record.
        const visibleTab = whileTabVisible(document, tabCamera);
        runCamera = visibleTab.camera;
        const outcome = recorder.record({ kind: 'date-range', from: range.from, to: range.to }, run);
        // Start the clipboard write now, inside the click, with the PNG to follow.
        const copied = copyPngToClipboard(
          outcome.then((o) => (o.kind === 'record' ? o.record.image : Promise.reject(new Error(o.kind)))),
        );
        return Promise.all([outcome, copied.then(() => undefined, (error: unknown) => error)])
          .then(([o, clipboardError]): CreateResult => {
            if (o.kind === 'failed') return o;
            if (o.kind === 'no-messages' || o.kind === 'cancelled') return o;
            const file = { name: o.record.fileName, image: o.record.image };
            if (clipboardError) return { kind: 'made', file, clipboard: { copied: false, detail: String(clipboardError) } };
            return { kind: 'made', file, clipboard: { copied: true } };
          })
          .finally(() => {
            visibleTab.release();
            recording = false;
          });
      },
      download(file) {
        downloadFile(document, file.image, file.name);
      },
    });

    const tabCamera = createTabCamera({ hideOwnUi: () => panel.hide() });
    /** The Camera of the Chat Record being made. */
    let runCamera: Camera = tabCamera;
    const recorder = createChatRecorder({ page, camera: { capture: () => runCamera.capture() } });

    keepInChatHeader(document, panel.button);
    chrome.runtime.onMessage.addListener((message) => {
      if (isOpenPanelRequest(message)) panel.open();
    });
  },
});
