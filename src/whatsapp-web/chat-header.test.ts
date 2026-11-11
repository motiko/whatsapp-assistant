import { afterEach, describe, expect, test } from 'vitest';
import { keepInChatHeader } from './chat-header';
import { loadSnapshot } from './testing/load-snapshot';
import oneToOneChat from './fixtures/one-to-one-chat.html?raw';
import groupChat from './fixtures/group-chat.html?raw';

afterEach(() => {
  document.querySelectorAll('iframe').forEach((frame) => frame.remove());
});

/** Does what WhatsApp Web does when the user opens another Chat: swaps the conversation pane. */
function switchChatTo(doc: Document, snapshot: string) {
  const next = new DOMParser().parseFromString(snapshot, 'text/html').querySelector('#main')!;
  doc.querySelector('#main')!.replaceWith(doc.importNode(next, true));
}

const mutationsDelivered = () => new Promise((resolve) => setTimeout(resolve, 0));

function headerHolding(button: HTMLElement) {
  return button.isConnected ? button.closest('header') : null;
}

describe('the header button', () => {
  test("sits in the open Chat's header", async () => {
    const doc = await loadSnapshot(oneToOneChat);
    const button = doc.createElement('button');

    keepInChatHeader(doc, button);

    expect(headerHolding(button)?.textContent).toContain('Contact A');
  });

  test("moves to the new Chat's header after switching to a group Chat", async () => {
    const doc = await loadSnapshot(oneToOneChat);
    const button = doc.createElement('button');
    keepInChatHeader(doc, button);

    switchChatTo(doc, groupChat);
    await mutationsDelivered();

    expect(headerHolding(button)?.textContent).toContain('Group Chat B');
  });

  test('appears once a Chat is opened when WhatsApp Web started with none open', async () => {
    const doc = await loadSnapshot(oneToOneChat);
    const pane = doc.querySelector('#main')!;
    const placeholder = doc.createElement('div');
    pane.replaceWith(placeholder);
    const button = doc.createElement('button');
    keepInChatHeader(doc, button);

    placeholder.replaceWith(pane);
    await mutationsDelivered();

    expect(headerHolding(button)?.textContent).toContain('Contact A');
  });
});
