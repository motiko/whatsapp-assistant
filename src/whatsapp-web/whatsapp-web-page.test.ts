import { afterEach, describe, expect, test } from 'vitest';
import { createWhatsAppWebPage } from './whatsapp-web-page';
import { loadSnapshot } from './testing/load-snapshot';
import oneToOneChat from './fixtures/one-to-one-chat.html?raw';
import groupChat from './fixtures/group-chat.html?raw';
import unrelatedPage from './fixtures/unrelated-page.html?raw';
import multiDayChat from './fixtures/multi-day-chat.html?raw';
import readMoreChat from './fixtures/read-more-chat.html?raw';
import { emulateReadMore } from './testing/emulate-read-more';
import olderMessagesOnPhone from './fixtures/older-messages-on-phone.html?raw';
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

describe('WhatsApp Web adapter on a Chat spanning several days', () => {
  // The snapshot's day: Wednesday 11 November 2026, in a day/month/year locale.
  const options = { today: () => new Date(2026, 10, 11, 15, 30), locale: 'en-GB', settleMs: 0 };
  // From the snapshot's fixed layout: list padding 12, divider rows 50,
  // message rows 60, the "unread messages" banner 40.
  const dividers = [
    { kind: 'date-divider', day: '2026-10-28', top: 12, bottom: 62 },
    { kind: 'date-divider', day: '2026-11-03', top: 422, bottom: 472 },
    { kind: 'date-divider', day: '2026-11-09', top: 832, bottom: 882 },
    { kind: 'date-divider', day: '2026-11-10', top: 1182, bottom: 1232 },
    { kind: 'date-divider', day: '2026-11-11', top: 1532, bottom: 1582 },
  ];

  test('reports each date divider with its day: dates, a weekday, "Yesterday" and "Today"', async () => {
    const page = createWhatsAppWebPage(await loadSnapshot(multiDayChat), options);

    expect(page.loadedItems().filter((item) => item.kind === 'date-divider')).toEqual(dividers);
  });

  test('reports the messages after a divider, each named by its WhatsApp id with the time it shows, and leaves out rows that are neither', async () => {
    const page = createWhatsAppWebPage(await loadSnapshot(multiDayChat), options);

    const items = page.loadedItems();

    expect(items.filter((item) => item.kind === 'message')).toHaveLength(26);
    // Today: two messages, the unread banner (1702-1742, left out), two more.
    expect(items.slice(-5)).toEqual([
      dividers[4],
      { kind: 'message', id: 'false_10000000001@c.us_SYNTH0023', time: '09:41', top: 1582, bottom: 1642 },
      { kind: 'message', id: 'true_10000000001@c.us_SYNTH0024', time: '10:48', top: 1642, bottom: 1702 },
      { kind: 'message', id: 'false_10000000001@c.us_SYNTH0025', time: '11:55', top: 1742, bottom: 1802 },
      { kind: 'message', id: 'true_10000000001@c.us_SYNTH0026', time: '12:02', top: 1802, bottom: 1862 },
    ]);
  });

  test('reports the scroll height and scrolls, keeping positions relative to the list content', async () => {
    const page = createWhatsAppWebPage(await loadSnapshot(multiDayChat), options);

    await page.scrollTo(500);

    expect(page.scrollTop()).toBe(500);
    // Rows end at 1862, plus 8 of list padding.
    expect(page.scrollHeight()).toBe(1870);
    expect(page.loadedItems().filter((item) => item.kind === 'date-divider')).toEqual(dividers);
  });

  test('stops scrolling at the newest message', async () => {
    const page = createWhatsAppWebPage(await loadSnapshot(multiDayChat), options);

    await page.scrollTo(5000);

    // 1870 of content in a 679 tall chat area.
    expect(page.scrollTop()).toBe(1191);
  });

  test('raises "page not recognised" when a divider\'s date does not fit the locale\'s date order', async () => {
    const page = createWhatsAppWebPage(await loadSnapshot(multiDayChat), { ...options, locale: 'en-US' });

    // "28/10/2026" is no date in a month/day/year locale.
    expect(() => page.loadedItems()).toThrow(PageNotRecognisedError);
  });
});

describe('WhatsApp Web adapter on a Chat with long messages behind "Read more"', () => {
  const options = { today: () => new Date(2026, 10, 11, 15, 30), locale: 'en-GB', settleMs: 0 };

  async function openChat() {
    const doc = await loadSnapshot(readMoreChat);
    // Each "Read more" hides six more lines of 20px.
    emulateReadMore(doc, 6);
    return createWhatsAppWebPage(doc, options);
  }

  test('reports a truncated message as tall as it is shown, with "Read more"', async () => {
    const page = await openChat();

    // From the snapshot's fixed layout: list padding 12, the divider row 50,
    // a message row 20 plus 20 a line, a truncated one three lines and "Read more".
    expect(page.loadedItems().slice(0, 5)).toEqual([
      { kind: 'date-divider', day: '2026-11-11', top: 12, bottom: 62 },
      { kind: 'message', id: 'false_10000000001@c.us_SYNTH0001', time: '09:07', top: 62, bottom: 122 },
      { kind: 'message', id: 'true_10000000001@c.us_SYNTH0002', time: '09:14', top: 122, bottom: 222 },
      { kind: 'message', id: 'false_10000000001@c.us_SYNTH0003', time: '09:21', top: 222, bottom: 282 },
      { kind: 'message', id: 'false_10000000001@c.us_SYNTH0004', time: '09:28', top: 282, bottom: 382 },
    ]);
  });

  test('expands every message in the span, even one only partly in it, and the rows below move down', async () => {
    const page = await openChat();

    // The span cuts into the two truncated messages at 122-222 and 282-382.
    await page.expandReadMore({ top: 150, bottom: 300 });

    // Each grows by 100 (six more lines, without "Read more"); the third
    // truncated message (742-842 before) is outside the span and stays as it was.
    const messages = page.loadedItems().filter((item) => item.kind === 'message');
    expect(messages.map(({ top, bottom }) => [top, bottom])).toEqual([
      [62, 122],
      [122, 322],
      [322, 382],
      [382, 582],
      [582, 642],
      [642, 702],
      [702, 762],
      [762, 822],
      [822, 882],
      [882, 942],
      [942, 1042],
      [1042, 1102],
    ]);
  });

  test('leaves the Chat as it is when the span has no "Read more"', async () => {
    const page = await openChat();
    const before = page.loadedItems();

    await page.expandReadMore({ top: 382, bottom: 742 });

    expect(page.loadedItems()).toEqual(before);
  });

  test('raises "page not recognised" when clicking "Read more" does not show the rest', async () => {
    // Without the emulated behaviour, "Read more" is just text.
    const page = createWhatsAppWebPage(await loadSnapshot(readMoreChat), options);

    await expect(page.expandReadMore({ top: 150, bottom: 300 })).rejects.toThrow(PageNotRecognisedError);
  });
});

describe('WhatsApp Web adapter loading older messages', () => {
  const options = { today: () => new Date(2026, 10, 11, 15, 30), locale: 'en-GB', settleMs: 0, olderMessagesWaitMs: 100 };

  /**
   * Plays WhatsApp Web's part, which a saved snapshot can't: after `delayMs`,
   * puts a day of older messages (20 Oct 2026, two messages) at the top of
   * the message list, as WhatsApp Web does once it has fetched them.
   */
  function addOlderDayLater(doc: Document, delayMs = 30) {
    setTimeout(() => {
      const list = doc.querySelector('#main [data-tab="8"]')!;
      const rows = ['<div class="_amjw focusable-list-item"><span dir="auto">20/10/2026</span></div>'];
      for (const n of [1, 2]) {
        rows.push(`<div class="message-in focusable-list-item" data-id="false_10000000001@c.us_OLDER000${n}"><div class="_amk6">Older message ${n}.</div></div>`);
      }
      const older = rows.map((html) => Object.assign(doc.createElement('div'), { innerHTML: html }));
      // Like the real page: messages are rows, date dividers are not.
      older.slice(1).forEach((row) => row.setAttribute('role', 'row'));
      const firstDay = Array.from(list.children).find((row) => row.querySelector('._amjw'))!;
      firstDay.before(...older);
    }, delayMs);
  }

  const firstDivider = (page: ReturnType<typeof createWhatsAppWebPage>) =>
    page.loadedItems().find((item) => item.kind === 'date-divider');

  test('reports that no older messages are available when nothing more loads at the top', async () => {
    const page = createWhatsAppWebPage(await loadSnapshot(multiDayChat), options);
    await page.scrollTo(500);

    const result = await page.loadOlder();

    expect(result).toBe('no-older-messages');
    expect(page.scrollTop()).toBe(0);
    expect(firstDivider(page)).toMatchObject({ day: '2026-10-28' });
  });

  test('loads the older messages WhatsApp Web adds when scrolled to the top', async () => {
    const doc = await loadSnapshot(multiDayChat);
    const page = createWhatsAppWebPage(doc, options);
    await page.scrollTo(500);
    const scroller = doc.querySelector('._ajyl')!;
    scroller.addEventListener('scroll', () => scroller.scrollTop === 0 && addOlderDayLater(doc), { once: true });

    const result = await page.loadOlder();

    expect(result).toBe('loaded');
    expect(firstDivider(page)).toMatchObject({ day: '2026-10-20' });
  });

  test('does not report the older-messages prompt as a divider or a message', async () => {
    const page = createWhatsAppWebPage(await loadSnapshot(olderMessagesOnPhone), options);

    // List padding 12, then the 40px prompt row, then the first divider.
    expect(page.loadedItems()[0]).toEqual({ kind: 'date-divider', day: '2026-10-28', top: 52, bottom: 102 });
  });

  test('clicks the prompt to get older messages from the phone, and loads what arrives', async () => {
    const doc = await loadSnapshot(olderMessagesOnPhone);
    const page = createWhatsAppWebPage(doc, options);
    const prompt = doc.querySelector<HTMLElement>('._ahmw button')!;
    let clicks = 0;
    prompt.addEventListener('click', () => {
      clicks++;
      prompt.closest('._ahmw')!.remove();
      addOlderDayLater(doc);
    });

    const result = await page.loadOlder();

    expect(result).toBe('loaded');
    expect(clicks).toBe(1);
    expect(firstDivider(page)).toMatchObject({ day: '2026-10-20' });
  });

  test('reports that no older messages are available when the prompt brings none (e.g. the phone is offline)', async () => {
    const doc = await loadSnapshot(olderMessagesOnPhone);
    const page = createWhatsAppWebPage(doc, options);
    let clicks = 0;
    doc.querySelector('._ahmw button')!.addEventListener('click', () => clicks++);

    const result = await page.loadOlder();

    expect(result).toBe('no-older-messages');
    expect(clicks).toBe(1);
    expect(firstDivider(page)).toMatchObject({ day: '2026-10-28' });
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

  test('raises "page not recognised" instead of reporting dividers and messages', async () => {
    const page = createWhatsAppWebPage(await loadSnapshot(unrelatedPage));

    expect(() => page.loadedItems()).toThrow(PageNotRecognisedError);
    expect(() => page.scrollTop()).toThrow(PageNotRecognisedError);
  });
});

describe('WhatsApp Web adapter in a tab that paints no frames', () => {
  // Chrome runs no animation frames in a background tab; scrolling and
  // waiting must still finish there.
  const options = { today: () => new Date(2026, 10, 11, 15, 30), locale: 'en-GB', settleMs: 0, olderMessagesWaitMs: 100 };

  async function backgroundTab(html: string) {
    const doc = await loadSnapshot(html);
    doc.defaultView!.requestAnimationFrame = () => 0;
    return doc;
  }

  test('still scrolls and settles', async () => {
    const page = createWhatsAppWebPage(await backgroundTab(multiDayChat), options);

    await page.scrollTo(500);

    expect(page.scrollTop()).toBe(500);
  });

  test('still finds out that no older messages are available', async () => {
    const page = createWhatsAppWebPage(await backgroundTab(multiDayChat), options);

    await expect(page.loadOlder()).resolves.toBe('no-older-messages');
  });
});
