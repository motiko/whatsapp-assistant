import type { Rect, WhatsAppPage } from '../whatsapp-page';

/** A scripted WhatsApp Page: an open Chat with a known name and layout. */
export function createFakeWhatsAppPage(options: {
  chatName: string;
  chatArea: Rect;
}): WhatsAppPage {
  return {
    chatName: () => options.chatName,
    chatArea: () => ({ ...options.chatArea }),
  };
}
