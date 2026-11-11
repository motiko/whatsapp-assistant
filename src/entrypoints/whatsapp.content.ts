import { createChatRecorder } from '../core/chat-recorder';
import { copyPngToClipboard } from '../extension/clipboard';
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
      createChatRecord() {
        if (recording) return Promise.resolve({ kind: 'failed', reason: 'capture-failed', detail: 'a Chat Record is already being made' });
        recording = true;
        const outcome = recorder.record({ kind: 'visible' });
        // Start the clipboard write now, inside the click, with the PNG to follow.
        const copied = copyPngToClipboard(
          outcome.then((o) => (o.kind === 'record' ? o.record.image : Promise.reject(new Error(o.detail)))),
        );
        return Promise.all([outcome, copied.then(() => undefined, (error: unknown) => error)])
          .then(([o, clipboardError]): CreateResult => {
            if (o.kind === 'failed') return o;
            if (clipboardError) return { kind: 'failed', reason: 'clipboard-failed', detail: String(clipboardError) };
            return { kind: 'copied' };
          })
          .finally(() => {
            recording = false;
          });
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
