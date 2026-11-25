import { afterEach, describe, expect, test } from 'vitest';
import { createAudioTap, installAudioProbe } from './audio-probe';
import { createChatsPage } from './chats-page';
import translatedChat from './fixtures/translated-chat.html?raw';
import modernChat from './fixtures/modern-chat.html?raw';
import unrelatedPage from './fixtures/unrelated-page.html?raw';
import { emulateChats } from './testing/emulate-chats';
import { emulateReadMore } from './testing/emulate-read-more';
import { loadSnapshot } from './testing/load-snapshot';

afterEach(() => {
  document.querySelectorAll('iframe').forEach((frame) => frame.remove());
});

const fast = { openWaitMs: 300, sendWaitMs: 300, readMoreWaitMs: 300 };

describe('WhatsApp Web’s Chat list', () => {
  test('lists the Chats it shows, by name', async () => {
    const page = createChatsPage(await loadSnapshot(translatedChat));

    expect(page.chatListNames()).toEqual(['Contact A', 'Contact D', 'Group Chat B']);
  });

  test('tells whether a Chat’s row shows unread messages', async () => {
    const page = createChatsPage(await loadSnapshot(translatedChat));

    expect(page.chatListRow('Contact D')?.unread).toBe(true);
    expect(page.chatListRow('Group Chat B')?.unread).toBe(false);
    expect(page.chatListRow('Group Chat B')?.text).toContain('Contact C: Placeholder');
  });

  test('has no row for a Chat it doesn’t show', async () => {
    const page = createChatsPage(await loadSnapshot(translatedChat));

    expect(page.chatListRow('Nobody')).toBeUndefined();
  });

  test('is empty on a page that isn’t WhatsApp Web’s Chat view', async () => {
    const page = createChatsPage(await loadSnapshot(unrelatedPage));

    expect(page.chatListNames()).toEqual([]);
    expect(page.openChatName()).toBeUndefined();
  });
});

describe('opening a Chat', () => {
  test('clicks its row and resolves once WhatsApp Web shows it', async () => {
    const doc = await loadSnapshot(translatedChat);
    emulateChats(doc);
    const page = createChatsPage(doc, fast);

    await page.openChat('Group Chat B');

    expect(page.openChatName()).toBe('Group Chat B');
  });

  test('searches for a Chat that isn’t in the Chat list, then empties the search box', async () => {
    const doc = await loadSnapshot(translatedChat);
    emulateChats(doc, { searchable: ['Contact Z'] });
    const page = createChatsPage(doc, fast);

    await page.openChat('Contact Z');

    expect(page.openChatName()).toBe('Contact Z');
    expect(doc.querySelector<HTMLElement>('#side [contenteditable]')!.innerText.trim()).toBe('');
  });

  test('fails for a Chat WhatsApp Web can’t find', async () => {
    const doc = await loadSnapshot(translatedChat);
    emulateChats(doc);
    const page = createChatsPage(doc, fast);

    await expect(page.openChat('Nobody')).rejects.toThrow('no Chat named "Nobody"');
  });

  test('fails when WhatsApp Web does not open the clicked Chat', async () => {
    const page = createChatsPage(await loadSnapshot(translatedChat), fast);

    await expect(page.openChat('Contact D')).rejects.toThrow('did not open it');
  });
});

describe('reading the open Chat', () => {
  test('reads each message with its id, direction, sender and text, emoji and line breaks included', async () => {
    const doc = await loadSnapshot(translatedChat);
    emulateReadMore(doc, 1);
    const page = createChatsPage(doc, fast);

    const messages = await page.readMessages();

    expect(messages.slice(0, 3)).toEqual([
      {
        id: 'false_491500000001@c.us_SYNTHIN01',
        direction: 'in',
        sender: 'Contact A',
        text: "Guten Morgen! 😀\nWie geht's?",
      },
      { id: 'true_491500000001@c.us_SYNTHOUT1', direction: 'out', sender: 'Me', text: 'Gut, danke!' },
      { id: 'false_491500000001@c.us_SYNTHIN02', direction: 'in' },
    ]);
  });

  test('expands a message cut short behind "Read more" before reading it', async () => {
    const doc = await loadSnapshot(translatedChat);
    emulateReadMore(doc, 1);
    const page = createChatsPage(doc, fast);

    const last = (await page.readMessages()).at(-1)!;

    expect(last.text).toBe('Ein langer Anfang.Placeholder rest of a long message.');
  });

  test('tells it shows the newest messages', async () => {
    const page = createChatsPage(await loadSnapshot(translatedChat));

    expect(page.atNewest()).toBe(true);
  });
});

describe('sending a message', () => {
  test('types it into the message box, sends it, and sees it arrive in the Chat', async () => {
    const doc = await loadSnapshot(translatedChat);
    emulateChats(doc);
    const page = createChatsPage(doc, fast);

    const outcome = await page.sendMessage('Hallo!\nBis morgen');

    expect(outcome).toEqual({ kind: 'sent', id: 'true_491500000001@c.us_SENT1' });
    const sent = (await page.readMessages()).at(-1)!;
    expect(sent.direction).toBe('out');
    expect(sent.text).toBe('Hallo!\nBis morgen');
    expect(doc.querySelector<HTMLElement>('#main footer [contenteditable]')!.innerText.trim()).toBe('');
  });

  test('refuses when the message box already holds text the user typed', async () => {
    const doc = await loadSnapshot(translatedChat);
    emulateChats(doc);
    doc.querySelector('#main footer [contenteditable] p')!.textContent = 'half a sentence';
    const page = createChatsPage(doc, fast);

    const outcome = await page.sendMessage('Hallo');

    expect(outcome).toEqual({ kind: 'failed', detail: 'the message box in WhatsApp Web already has unsent text in it' });
    expect(doc.querySelector('#main footer [contenteditable]')!.textContent).toBe('half a sentence');
  });

  test('fails when WhatsApp Web does not send it', async () => {
    const page = createChatsPage(await loadSnapshot(translatedChat), fast);

    const outcome = await page.sendMessage('Hallo');

    expect(outcome).toEqual({ kind: 'failed', detail: 'WhatsApp Web did not send it; it is still in the message box' });
  });
});

describe('the newer page (Nov 2026): message ids without who sent them, no message-in/out classes', () => {
  test('reads each message, and who sent it from the side its bubble sits on', async () => {
    const page = createChatsPage(await loadSnapshot(modernChat), fast);

    expect(await page.readMessages()).toEqual([
      { id: '3EB0A1B2C3D4E5F60001', direction: 'in', sender: 'Contact A', text: 'Guten Morgen!' },
      { id: '3EB0A1B2C3D4E5F60002', direction: 'out', sender: 'Me', text: 'Gut, danke!' },
      { id: 'A5C1D2E3F4A5B6C70003', direction: 'in' },
      { id: 'A5C1D2E3F4A5B6C70004', direction: 'in', sender: 'Contact A', text: 'Bis später' },
      // A reply quoting the message above: its own text and sender, not the quote's.
      { id: '3EB0A1B2C3D4E5F60005', direction: 'out', sender: 'Me', text: 'Klingt gut' },
      // A voice note: its length, not the time it was sent.
      { id: 'A5C1D2E3F4A5B6C70006', direction: 'in', voice: { seconds: 23 } },
    ]);
  });

  test('in a right-to-left page (a Hebrew or Arabic WhatsApp Web), the sides are the other way round', async () => {
    const doc = await loadSnapshot(modernChat);
    doc.documentElement.dir = 'rtl';
    doc.documentElement.style.direction = 'rtl';
    const page = createChatsPage(doc, fast);

    expect((await page.readMessages()).map((message) => message.direction)).toEqual(['in', 'out', 'in', 'in', 'out', 'in']);
  });

  test('lists Chat list rows that are role="row"', async () => {
    const page = createChatsPage(await loadSnapshot(modernChat));

    expect(page.chatListNames()).toEqual(['Contact A', 'Contact D', 'Family', 'Photo Friend']);
  });

  test('reads a row\u2019s unread count and its last message in full (from its title, not the cut-short text)', async () => {
    const page = createChatsPage(await loadSnapshot(modernChat));

    expect(page.chatListRow('Contact D')).toMatchObject({ unread: true, unreadCount: 1, preview: { text: 'Hallo? Bist du da?' } });
  });

  test('reads a group row\u2019s sender, and the unread count in any language', async () => {
    const page = createChatsPage(await loadSnapshot(modernChat));

    expect(page.chatListRow('Family')).toMatchObject({ unread: true, unreadCount: 2, preview: { text: 'Wer kommt heute?', sender: 'Zak' } });
  });

  test('gives no message for a row whose last message isn\u2019t plain text (an icon beside it)', async () => {
    const page = createChatsPage(await loadSnapshot(modernChat));

    const row = page.chatListRow('Photo Friend');

    expect(row).toMatchObject({ unread: true, unreadCount: 1 });
    expect(row?.preview).toBeUndefined();
  });

  test('a row without unread messages has no badge and no count', async () => {
    const page = createChatsPage(await loadSnapshot(modernChat));

    const row = page.chatListRow('Contact A');

    expect(row?.unread).toBe(false);
    expect(row?.unreadCount).toBeUndefined();
  });

  test('sends with Enter when there is no send icon, and sees the message arrive as the user\u2019s own', async () => {
    const doc = await loadSnapshot(modernChat);
    emulateChats(doc, { modern: true });
    const page = createChatsPage(doc, fast);

    const outcome = await page.sendMessage('Hallo');

    expect(outcome).toEqual({ kind: 'sent', id: '3EB0SENT0001' });
    expect((await page.readMessages()).at(-1)).toMatchObject({ id: '3EB0SENT0001', direction: 'out', text: 'Hallo' });
  });
});

test('waits for the message box\u2019s editor, which applies typed text a moment later, then sends', async () => {
  const doc = await loadSnapshot(modernChat);
  emulateChats(doc, { modern: true, delayedEditor: true });
  const page = createChatsPage(doc, fast);

  const outcome = await page.sendMessage('Hallo!\nBis morgen');

  expect(outcome).toEqual({ kind: 'sent', id: '3EB0SENT0001' });
  expect((await page.readMessages()).at(-1)).toMatchObject({ direction: 'out', text: 'Hallo!\nBis morgen' });
});

test('reads a Chat list row\u2019s message without the invisible direction marks WhatsApp Web puts around it', async () => {
  const doc = await loadSnapshot(modernChat);
  const title = doc.querySelector('#pane-side span[title="Hallo? Bist du da?"]')!;
  title.setAttribute('title', '\u202A\u200EHallo? Bist du da?\u202C');
  const page = createChatsPage(doc);

  expect(page.chatListRow('Contact D')?.preview?.text).toBe('Hallo? Bist du da?');
});


describe('voice notes\u2019 audio', () => {
  const voiceId = 'A5C1D2E3F4A5B6C70006';
  /** The modern page with the Audio Probe in its world, as the MAIN-world content script installs it. */
  async function withProbe(voice = 'bis morgen') {
    const doc = await loadSnapshot(modernChat);
    const view = doc.defaultView as Window & typeof globalThis;
    installAudioProbe(view);
    emulateChats(doc, { modern: true, voice });
    return { doc, page: createChatsPage(doc, { ...fast, audioTap: createAudioTap(view), voiceWaitMs: 2000 }) };
  }

  test('presses play, silently, takes the audio the page made, and stops it again', async () => {
    const { page } = await withProbe('bis morgen');

    const result = await page.voiceAudio(voiceId, { mayPlay: true });

    expect(result.kind).toBe('audio');
    if (result.kind !== 'audio') return;
    expect(result.played).toBe(true);
    expect(await result.audio.text()).toBe('bis morgen');
    expect(result.audio.type).toContain('audio/ogg');
  });

  test('takes audio the voice note already has (played before) without playing it', async () => {
    const { doc, page } = await withProbe();
    const view = doc.defaultView!;
    const audio = doc.createElement('audio');
    audio.src = view.URL.createObjectURL(new view.Blob(['schon gehört'], { type: 'audio/ogg' }));
    doc.querySelector(`[data-id="${voiceId}"] .bubble`)!.append(audio);

    const result = await page.voiceAudio(voiceId, { mayPlay: false });

    expect(result.kind === 'audio' && result.played).toBe(false);
    expect(result.kind === 'audio' && (await result.audio.text())).toBe('schon gehört');
  });

  test('does not play it when playing is turned off', async () => {
    const { page } = await withProbe();

    expect(await page.voiceAudio(voiceId, { mayPlay: false })).toMatchObject({ kind: 'failed', detail: expect.stringContaining('turned off') });
  });

  test('fails, without hanging, when pressing play gives no audio', async () => {
    const doc = await loadSnapshot(modernChat);
    const view = doc.defaultView as Window & typeof globalThis;
    installAudioProbe(view);
    const page = createChatsPage(doc, { ...fast, audioTap: createAudioTap(view), voiceWaitMs: 500 });

    expect(await page.voiceAudio(voiceId, { mayPlay: true })).toEqual({ kind: 'failed', detail: 'pressing play gave no audio in time' });
  });

  test('fails for a message no longer shown', async () => {
    const { page } = await withProbe();

    expect(await page.voiceAudio('gone', { mayPlay: true })).toMatchObject({ kind: 'failed' });
  });
});
