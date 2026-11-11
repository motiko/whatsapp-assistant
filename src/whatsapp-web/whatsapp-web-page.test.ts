import { afterEach, describe, expect, test } from 'vitest';
import { createWhatsAppWebPage } from './whatsapp-web-page';
import { loadSnapshot } from './testing/load-snapshot';
import oneToOneChat from './fixtures/one-to-one-chat.html?raw';
import groupChat from './fixtures/group-chat.html?raw';
import unrelatedPage from './fixtures/unrelated-page.html?raw';
import { PageNotRecognisedError } from '../core/whatsapp-page';

afterEach(() => {
  document.querySelectorAll('iframe').forEach((frame) => frame.remove());
});

describe('WhatsApp Web adapter on an open Chat', () => {
  test('reports the name of a one-to-one Chat', async () => {
    const page = createWhatsAppWebPage(await loadSnapshot(oneToOneChat));

    expect(page.chatName()).toBe('Contact A');
  });

  test('reports the name of a group Chat', async () => {
    const page = createWhatsAppWebPage(await loadSnapshot(groupChat));

    expect(page.chatName()).toBe('Group Chat B');
  });

  test('reports where the chat area is: between the Chat header and the message box, right of the Chat list, without the scrollbar', async () => {
    const page = createWhatsAppWebPage(await loadSnapshot(oneToOneChat));

    // From the snapshot's layout at 1280x800: nav rail 64 + Chat list 400,
    // header 59, message box 62, scrollbar 6.
    expect(page.chatArea()).toEqual({ left: 464, top: 59, width: 810, height: 679 });
  });
});

describe('WhatsApp Web adapter on a page it does not recognise', () => {
  test('raises "page not recognised" instead of reporting a Chat name', async () => {
    const page = createWhatsAppWebPage(await loadSnapshot(unrelatedPage));

    expect(() => page.chatName()).toThrow(PageNotRecognisedError);
  });

  test('raises "page not recognised" instead of reporting a chat area', async () => {
    const page = createWhatsAppWebPage(await loadSnapshot(unrelatedPage));

    expect(() => page.chatArea()).toThrow(PageNotRecognisedError);
  });
});
