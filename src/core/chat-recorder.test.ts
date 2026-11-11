import { describe, expect, test } from 'vitest';
import { CaptureNotAllowedError, type Camera } from './camera';
import { createChatRecorder, type ChatRecordOutcome } from './chat-recorder';
import { drawContextBand } from './context-band';
import { PageNotRecognisedError, type WhatsAppPage } from './whatsapp-page';
import { createFakeCamera, readScreenPositions } from './testing/fake-camera';
import { readPdfPages } from './testing/read-pdf';
import { createFakeWhatsAppPage, type FakeChatDay } from './testing/fake-whatsapp-page';

const viewport = { width: 1280, height: 800 };
// Chat list on the left (400px), Chat header above (60px), message box below (62px).
const chatArea = { left: 400, top: 60, width: 880, height: 678 };

describe('Chat Record of the visible chat', () => {
  test('is exactly the chat area of the screen, without the Chat list, header or message box', async () => {
    const recorder = createChatRecorder({
      page: createFakeWhatsAppPage({ chatName: 'Alice', chatArea }),
      camera: createFakeCamera({ viewport }),
    });

    const outcome = await recorder.record({ kind: 'visible' });

    expect(outcome.kind).toBe('record');
    if (outcome.kind !== 'record') return;
    const image = await readScreenPositions(outcome.record.image);
    const band = image.height - 678;
    expect(image.width).toBe(880);
    expect(image.at(0, band)).toEqual({ x: 400, y: 60 });
    expect(image.at(879, band + 677)).toEqual({ x: 1279, y: 737 });
  });

  test('keeps every device pixel of the chat area on a high-density screen', async () => {
    const recorder = createChatRecorder({
      page: createFakeWhatsAppPage({ chatName: 'Alice', chatArea }),
      camera: createFakeCamera({ viewport, devicePixelRatio: 2 }),
    });

    const outcome = await recorder.record({ kind: 'visible' });

    expect(outcome.kind).toBe('record');
    if (outcome.kind !== 'record') return;
    const image = await readScreenPositions(outcome.record.image);
    const band = image.height - 1356;
    expect(image.width).toBe(1760);
    expect(image.at(0, band)).toEqual({ x: 800, y: 120 });
    expect(image.at(1759, band + 1355)).toEqual({ x: 2559, y: 1475 });
  });
});

describe('Context Band', () => {
  test('sits above the WhatsApp pixels and leaves every one of them untouched', async () => {
    const recorder = createChatRecorder({
      page: createFakeWhatsAppPage({ chatName: 'Alice', chatArea }),
      camera: createFakeCamera({ viewport }),
    });

    const outcome = await recorder.record({ kind: 'visible' });

    expect(outcome.kind).toBe('record');
    if (outcome.kind !== 'record') return;
    const image = await readScreenPositions(outcome.record.image);
    const band = image.height - chatArea.height;
    expect(band).toBeGreaterThanOrEqual(40);
    expect(image.width).toBe(chatArea.width);
    expect(mismatchedChatPixels(image, band)).toEqual([]);
    expect(image.colourCount(0, 0, image.width, band)).toBeGreaterThan(1); // text is drawn on it
  });

  test("states the Chat's name, the day covered and when the Chat Record was taken", async () => {
    const recorder = createChatRecorder({
      page: createFakeWhatsAppPage({ chatName: 'Family 👨‍👩‍👧', chatArea }),
      camera: createFakeCamera({ viewport }),
      clock: () => new Date('2026-11-11T13:32:05Z'), // 14:32 in Berlin, the tests' timezone
    });

    const outcome = await recorder.record({ kind: 'visible' });

    expect(outcome).toMatchObject({
      kind: 'record',
      record: {
        span: { from: '2026-11-11', to: '2026-11-11' },
        takenAt: new Date('2026-11-11T13:32:05Z'),
        contextBand: ['Chat: Family 👨‍👩‍👧', 'Messages: 2026-11-11', 'Taken: 2026-11-11 14:32 (UTC+01:00)'],
      },
    });
  });

  test('covers the local day, not the UTC day, the Chat Record was taken on', async () => {
    const recorder = createChatRecorder({
      page: createFakeWhatsAppPage({ chatName: 'Alice', chatArea }),
      camera: createFakeCamera({ viewport }),
      clock: () => new Date('2026-11-11T23:30:00Z'), // already 12 November in Berlin
    });

    const outcome = await recorder.record({ kind: 'visible' });

    expect(outcome).toMatchObject({
      kind: 'record',
      record: {
        span: { from: '2026-11-12', to: '2026-11-12' },
        contextBand: ['Chat: Alice', 'Messages: 2026-11-12', 'Taken: 2026-11-12 00:30 (UTC+01:00)'],
      },
    });
  });

  test('wraps a long Chat name onto more lines instead of cutting it off', async () => {
    const shortName = createChatRecorder({
      page: createFakeWhatsAppPage({ chatName: 'Alice', chatArea }),
      camera: createFakeCamera({ viewport }),
    });
    const longName = createChatRecorder({
      page: createFakeWhatsAppPage({ chatName: 'Planning committee '.repeat(12).trim(), chatArea }),
      camera: createFakeCamera({ viewport }),
    });

    const [short, long] = await Promise.all([shortName.record({ kind: 'visible' }), longName.record({ kind: 'visible' })]);

    if (short.kind !== 'record' || long.kind !== 'record') throw new Error('expected Chat Records');
    const shortImage = await readScreenPositions(short.record.image);
    const longImage = await readScreenPositions(long.record.image);
    expect(longImage.width).toBe(chatArea.width);
    expect(longImage.height).toBeGreaterThan(shortImage.height);
    expect(mismatchedChatPixels(longImage, longImage.height - chatArea.height)).toEqual([]);
  });
});

describe('file name', () => {
  test("names the Chat Record after the Chat and the single day it covers", async () => {
    const recorder = createChatRecorder({
      page: createFakeWhatsAppPage({ chatName: 'Alice', chatArea }),
      camera: createFakeCamera({ viewport }),
      clock: () => new Date('2026-11-11T13:32:05Z'),
    });

    const outcome = await recorder.record({ kind: 'visible' });

    expect(outcome).toMatchObject({ kind: 'record', record: { fileName: 'Chat history - Alice - 2026-11-11.png' } });
  });

  test('replaces characters a file name cannot hold, and keeps emoji', async () => {
    const recorder = createChatRecorder({
      page: createFakeWhatsAppPage({ chatName: 'Mum/Dad: 🏡 plans', chatArea }),
      camera: createFakeCamera({ viewport }),
      clock: () => new Date('2026-11-11T13:32:05Z'),
    });

    const outcome = await recorder.record({ kind: 'visible' });

    expect(outcome).toMatchObject({
      kind: 'record',
      record: { chatName: 'Mum/Dad: 🏡 plans', fileName: 'Chat history - Mum_Dad_ 🏡 plans - 2026-11-11.png' },
    });
  });
});

// Six days, each a 40px date divider and five 100px messages: 540px per day,
// so day N (counting from 0) starts at content position 540 * N.
const sixDays = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'].map((day) => ({
  day,
  messageHeights: [100, 100, 100, 100, 100],
}));

function recorderFor(chat: FakeChatDay[], options: { devicePixelRatio?: number } = {}) {
  const page = createFakeWhatsAppPage({ chatName: 'Alice', chatArea, chat });
  const camera = createFakeCamera({ viewport, page, devicePixelRatio: options.devicePixelRatio });
  return createChatRecorder({ page, camera });
}

/**
 * The WhatsApp pixels of a recorded image: everything below its Context Band,
 * with row 0 the first row under the band.
 */
async function recordedImage(outcome: ChatRecordOutcome, devicePixelRatio = 1) {
  expect(outcome.kind).toBe('record');
  if (outcome.kind !== 'record') throw new Error('no record');
  const image = await readScreenPositions(outcome.record.image);
  const band = drawContextBand(outcome.record.contextBand, image.width, devicePixelRatio).height;
  expect(band).toBeGreaterThan(0);
  expect(image.height).toBeGreaterThan(band);
  return {
    width: image.width,
    height: image.height - band,
    at: (x: number, y: number) => image.at(x, band + y),
  };
}

describe('Chat Record of a Date Range', () => {
  test('includes both the first and the last day of the range in full, and nothing else', async () => {
    const recorder = recorderFor(sixDays);

    const outcome = await recorder.record({ kind: 'date-range', from: '2026-11-02', to: '2026-11-04' });

    // From the top of 2 Nov's divider (540) to the bottom of 4 Nov's last message (2160).
    const image = await recordedImage(outcome);
    expect(image.height).toBe(1620);
    expect(image.at(0, 0).y).toBe(540);
    expect(image.at(0, 1619).y).toBe(2159);
    expect(outcome).toMatchObject({ record: { span: { from: '2026-11-02', to: '2026-11-04' } } });
  });

  test('stitches the screens it scrolls through with no gaps and no repeated rows', async () => {
    const recorder = recorderFor(sixDays);

    const outcome = await recorder.record({ kind: 'date-range', from: '2026-11-02', to: '2026-11-04' });

    // 1620px of messages is more than two chat-area heights (678px).
    const image = await recordedImage(outcome);
    expect(image.width).toBe(880);
    for (let row = 0; row < image.height; row++) {
      expect(image.at(0, row)).toEqual({ x: 400, y: 540 + row });
      expect(image.at(879, row)).toEqual({ x: 1279, y: 540 + row });
    }
  });

  test('stitches seamlessly on a high-density screen, keeping every device pixel', async () => {
    // Six days of a 40px divider and five 60px messages: 340px per day.
    const chat = sixDays.map(({ day }) => ({ day, messageHeights: [60, 60, 60, 60, 60] }));
    const recorder = recorderFor(chat, { devicePixelRatio: 2 });

    const outcome = await recorder.record({ kind: 'date-range', from: '2026-11-02', to: '2026-11-04' });

    // 2 Nov's divider is at 340, 4 Nov's last message ends at 1360 (CSS px).
    const image = await recordedImage(outcome, 2);
    expect({ width: image.width, height: image.height }).toEqual({ width: 1760, height: 2040 });
    for (let row = 0; row < image.height; row++) {
      expect(image.at(0, row)).toEqual({ x: 800, y: 680 + row });
    }
  });

  test('records the whole Chat when the range covers it, from the first divider to the newest message', async () => {
    const recorder = recorderFor(sixDays);

    const outcome = await recorder.record({ kind: 'date-range', from: '2026-10-01', to: '2026-11-11' });

    const image = await recordedImage(outcome);
    expect(image.height).toBe(3240);
    expect(image.at(0, 0).y).toBe(0);
    expect(image.at(0, 3239).y).toBe(3239);
    expect(outcome).toMatchObject({ record: { span: { from: '2026-11-01', to: '2026-11-06' } } });
  });

  test('records a single day', async () => {
    const recorder = recorderFor(sixDays);

    const outcome = await recorder.record({ kind: 'date-range', from: '2026-11-06', to: '2026-11-06' });

    const image = await recordedImage(outcome);
    expect(image.height).toBe(540);
    expect(image.at(0, 0).y).toBe(2700);
    expect(outcome).toMatchObject({ record: { span: { from: '2026-11-06', to: '2026-11-06' } } });
  });

  test('starts at the first day with messages when the range starts on a day without any', async () => {
    const chat = sixDays.filter(({ day }) => day !== '2026-11-02' && day !== '2026-11-03');
    const recorder = recorderFor(chat);

    const outcome = await recorder.record({ kind: 'date-range', from: '2026-11-02', to: '2026-11-04' });

    // 1 Nov is 0-540; 4 Nov's divider follows at 540.
    const image = await recordedImage(outcome);
    expect(image.height).toBe(540);
    expect(image.at(0, 0).y).toBe(540);
    expect(outcome).toMatchObject({ record: { span: { from: '2026-11-04', to: '2026-11-04' } } });
  });

  test('ends after the last message on a day with messages when the range ends on a day without any', async () => {
    const chat = sixDays.filter(({ day }) => day !== '2026-11-04' && day !== '2026-11-05');
    const recorder = recorderFor(chat);

    const outcome = await recorder.record({ kind: 'date-range', from: '2026-11-02', to: '2026-11-05' });

    // 2 Nov and 3 Nov: 540 to 1620; 6 Nov's divider follows at 1620.
    const image = await recordedImage(outcome);
    expect(image.height).toBe(1080);
    expect(image.at(0, 1079).y).toBe(1619);
    expect(outcome).toMatchObject({ record: { span: { from: '2026-11-02', to: '2026-11-03' } } });
  });

  test('finds the first day while WhatsApp Web loads older messages above as it scrolls up', async () => {
    const page = createFakeWhatsAppPage({
      chatName: 'Alice',
      chatArea,
      chat: sixDays.slice(3),
      olderMessages: sixDays.slice(0, 3),
    });
    const recorder = createChatRecorder({ page, camera: createFakeCamera({ viewport, page }) });

    const outcome = await recorder.record({ kind: 'date-range', from: '2026-11-02', to: '2026-11-04' });

    const image = await recordedImage(outcome);
    expect(image.height).toBe(1620);
    expect(image.at(0, 0).y).toBe(540);
    expect(image.at(0, 1619).y).toBe(2159);
  });
});

describe('long messages behind "Read more" in a Date Range', () => {
  /**
   * A recorder of `chat`, and how many of its captures showed a message
   * still cut short behind "Read more".
   */
  function recorderWatchingReadMore(chat: FakeChatDay[]) {
    const page = createFakeWhatsAppPage({ chatName: 'Alice', chatArea, chat });
    const screen = createFakeCamera({ viewport, page });
    const watched = { capturesWithReadMore: 0 };
    const camera = {
      capture() {
        if (page.readMoreOnScreen()) watched.capturesWithReadMore += 1;
        return screen.capture();
      },
    };
    return { recorder: createChatRecorder({ page, camera }), watched };
  }

  test('are shown in full: the record is as tall as the expanded messages and stitched without gaps', async () => {
    const chat = [
      { day: '2026-11-01', messageHeights: [100, 100, 100, 100, 100] },
      // 2 Nov's divider is at 540. Its long message (1180-1280 cut short)
      // straddles the bottom of the first screen (540-1218) and grows to 1180-1480.
      { day: '2026-11-02', messageHeights: [100, 100, 100, 100, 100, 100, { truncated: 100, expanded: 300 }] },
      // 3 Nov: 1480-2020 once 2 Nov's long message is expanded.
      { day: '2026-11-03', messageHeights: [100, 100, 100, 100, 100] },
      // 4 Nov's divider is at 2020 and its last message, the long one, ends at
      // 2510 (2360 while cut short).
      { day: '2026-11-04', messageHeights: [100, 100, { truncated: 100, expanded: 250 }] },
      { day: '2026-11-05', messageHeights: [100, 100, 100, 100, 100] },
    ];
    const { recorder, watched } = recorderWatchingReadMore(chat);

    const outcome = await recorder.record({ kind: 'date-range', from: '2026-11-02', to: '2026-11-04' });

    expect(watched.capturesWithReadMore).toBe(0);
    const image = await recordedImage(outcome);
    expect(image.height).toBe(1970);
    for (let row = 0; row < image.height; row++) {
      expect(image.at(0, row)).toEqual({ x: 400, y: 540 + row });
    }
    expect(outcome).toMatchObject({ record: { span: { from: '2026-11-02', to: '2026-11-04' } } });
  });

  test('stay seamless when expanding one moves a later day\'s divider seen on an earlier screen', async () => {
    const chat = [
      // 1 Nov fills more than two screens: its divider (0-40) is long out of
      // sight when its long message (1440-1540 cut short, 1440-1840 in full) is
      // expanded, which moves 2 Nov's divider from 1540, where it was first
      // seen, to 1840.
      { day: '2026-11-01', messageHeights: [...Array<number>(14).fill(100), { truncated: 100, expanded: 400 }] },
      // 2 Nov's messages end at 1840 + 40 + 300 = 2180.
      { day: '2026-11-02', messageHeights: [100, 100, 100] },
      { day: '2026-11-03', messageHeights: [100, 100, 100, 100, 100] },
    ];
    const { recorder, watched } = recorderWatchingReadMore(chat);

    const outcome = await recorder.record({ kind: 'date-range', from: '2026-11-01', to: '2026-11-02' });

    expect(watched.capturesWithReadMore).toBe(0);
    const image = await recordedImage(outcome);
    expect(image.height).toBe(2180);
    for (let row = 0; row < image.height; row++) {
      expect(image.at(0, row)).toEqual({ x: 400, y: row });
    }
  });
});

describe('Context Band and file name of a Date Range', () => {
  test('are built from the days actually captured, above the stitched WhatsApp pixels', async () => {
    // 4 and 5 Nov have no messages, so a 2-5 Nov range captures 2-3 Nov.
    const chat = sixDays.filter(({ day }) => day !== '2026-11-04' && day !== '2026-11-05');
    const page = createFakeWhatsAppPage({ chatName: 'Alice', chatArea, chat });
    const recorder = createChatRecorder({
      page,
      camera: createFakeCamera({ viewport, page }),
      clock: () => new Date('2026-11-11T13:32:05Z'), // 14:32 in Berlin, the tests' timezone
    });

    const outcome = await recorder.record({ kind: 'date-range', from: '2026-11-02', to: '2026-11-05' });

    expect(outcome).toMatchObject({
      kind: 'record',
      record: {
        span: { from: '2026-11-02', to: '2026-11-03' },
        takenAt: new Date('2026-11-11T13:32:05Z'),
        contextBand: ['Chat: Alice', 'Messages: 2026-11-02 to 2026-11-03', 'Taken: 2026-11-11 14:32 (UTC+01:00)'],
        fileName: 'Chat history - Alice - 2026-11-02 to 2026-11-03.png',
      },
    });
    if (outcome.kind !== 'record') return;
    const whole = await readScreenPositions(outcome.record.image);
    const band = whole.height - 1080;
    expect(band).toBe(drawContextBand(outcome.record.contextBand, whole.width, 1).height);
    expect(whole.colourCount(0, 0, whole.width, band)).toBeGreaterThan(1); // text is drawn on it
    expect(whole.at(0, band)).toEqual({ x: 400, y: 540 });
    expect(whole.at(879, band + 1079)).toEqual({ x: 1279, y: 1619 });
  });
});

describe('a Date Range without messages', () => {
  const chatWithGap = sixDays.filter(({ day }) => day !== '2026-11-03' && day !== '2026-11-04');

  test.each([
    ['between two days with messages', '2026-11-03', '2026-11-04'],
    ['after the newest message', '2026-11-07', '2026-11-11'],
    ['before the oldest message', '2026-10-01', '2026-10-31'],
  ])('produces nothing when it is %s', async (_, from, to) => {
    const recorder = recorderFor(chatWithGap);

    const outcome = await recorder.record({ kind: 'date-range', from, to });

    expect(outcome).toEqual({ kind: 'no-messages', from, to });
  });
});

describe('a Chat Record that cannot be made', () => {
  test('fails, producing nothing, when the screen cannot be captured', async () => {
    const recorder = createChatRecorder({
      page: createFakeWhatsAppPage({ chatName: 'Alice', chatArea }),
      camera: createFakeCamera({ viewport, fails: new Error('Tab is hidden') }),
    });

    const outcome = await recorder.record({ kind: 'visible' });

    expect(outcome).toEqual({ kind: 'failed', reason: 'capture-failed', detail: 'Tab is hidden' });
  });

  test('fails with a distinct reason when Chrome does not allow capturing the tab', async () => {
    const recorder = createChatRecorder({
      page: createFakeWhatsAppPage({ chatName: 'Alice', chatArea }),
      camera: createFakeCamera({ viewport, fails: new CaptureNotAllowedError('activeTab not granted') }),
    });

    const outcome = await recorder.record({ kind: 'visible' });

    expect(outcome).toMatchObject({ kind: 'failed', reason: 'capture-not-allowed' });
  });

  test('fails with "page not recognised" when WhatsApp Web looks different from what is expected', async () => {
    const unrecognisedPage: WhatsAppPage = {
      ...createFakeWhatsAppPage({ chatName: 'Alice', chatArea }),
      chatName: () => {
        throw new PageNotRecognisedError('no Chat header');
      },
    };
    const recorder = createChatRecorder({
      page: unrecognisedPage,
      camera: createFakeCamera({ viewport }),
    });

    const outcome = await recorder.record({ kind: 'visible' });

    expect(outcome).toMatchObject({ kind: 'failed', reason: 'page-not-recognised' });
  });

  test('fails, producing nothing, when the screen cannot be captured part-way through a Date Range', async () => {
    const page = createFakeWhatsAppPage({ chatName: 'Alice', chatArea, chat: sixDays });
    const camera = createFakeCamera({ viewport, page, fails: new Error('Tab is hidden'), failsAfter: 1 });
    const recorder = createChatRecorder({ page, camera });

    const outcome = await recorder.record({ kind: 'date-range', from: '2026-11-02', to: '2026-11-04' });

    expect(outcome).toEqual({ kind: 'failed', reason: 'capture-failed', detail: 'Tab is hidden' });
  });
});

// A small screen, so Chats taller than ten chat areas stay within the positions
// the fake Camera can encode: a 100px tall chat area, at (100, 40).
const smallViewport = { width: 400, height: 200 };
const smallChatArea = { left: 100, top: 40, width: 300, height: 100 };

/** Days of a 40px divider and four 40px messages (200px each), from 1 Nov. */
function twoHundredPixelDays(count: number): FakeChatDay[] {
  return Array.from({ length: count }, (_, index) => ({
    day: `2026-11-${String(index + 1).padStart(2, '0')}`,
    messageHeights: [40, 40, 40, 40],
  }));
}

function smallScreenRecorderFor(chat: FakeChatDay[]) {
  const page = createFakeWhatsAppPage({ chatName: 'Alice', chatArea: smallChatArea, chat });
  const camera = createFakeCamera({ viewport: smallViewport, page });
  return createChatRecorder({ page, camera, clock: () => new Date('2026-11-11T13:32:05Z') });
}

describe('PNG or PDF', () => {
  test('a Chat Record exactly ten chat areas tall is one PNG', async () => {
    const recorder = smallScreenRecorderFor(twoHundredPixelDays(5));

    const outcome = await recorder.record({ kind: 'date-range', from: '2026-11-01', to: '2026-11-05' });

    // Five 200px days: 1000px, ten 100px chat areas.
    expect(outcome).toMatchObject({
      kind: 'record',
      record: { format: 'png', fileName: 'Chat history - Alice - 2026-11-01 to 2026-11-05.png' },
    });
    if (outcome.kind !== 'record') return;
    expect(outcome.record.image.type).toBe('image/png');
    const image = await readScreenPositions(outcome.record.image);
    const band = drawContextBand(outcome.record.contextBand, 300, 1).height;
    expect(image.height).toBe(band + 1000);
    expect(image.at(0, band + 999)).toEqual({ x: 100, y: 999 });
  });

  test('a Chat Record taller than ten chat areas is a PDF, saved under the standard name with .pdf', async () => {
    const chat = twoHundredPixelDays(5);
    chat[4]!.messageHeights = [40, 40, 40, 41];
    const recorder = smallScreenRecorderFor(chat);

    const outcome = await recorder.record({ kind: 'date-range', from: '2026-11-01', to: '2026-11-05' });

    // 1001px: one row more than ten chat areas.
    expect(outcome).toMatchObject({
      kind: 'record',
      record: { format: 'pdf', fileName: 'Chat history - Alice - 2026-11-01 to 2026-11-05.pdf' },
    });
    if (outcome.kind !== 'record') return;
    expect(outcome.record.image.type).toBe('application/pdf');
    const pages = await readPdfPages(outcome.record.image);
    expect(pages.length).toBeGreaterThan(1);
    const last = pages.at(-1)!;
    expect(last.at(299, last.height - 1)).toEqual({ x: 399, y: 1000 });
  });
});

describe('PDF pages', () => {
  // Three days of a 40px divider and seven messages of different heights (385px a day).
  const unevenDays: FakeChatDay[] = ['2026-11-01', '2026-11-02', '2026-11-03'].map((day) => ({
    day,
    messageHeights: [30, 70, 45, 60, 25, 80, 35],
  }));

  /** The content rows where the scripted Chat's dividers and messages start, laid out as the fake page does. */
  function itemTops(chat: FakeChatDay[]): Set<number> {
    const tops = new Set<number>();
    let y = 0;
    for (const { messageHeights } of chat) {
      for (const height of [40, ...messageHeights]) {
        tops.add(y);
        y += height;
      }
    }
    return tops;
  }

  async function pdfPages(outcome: ChatRecordOutcome) {
    expect(outcome).toMatchObject({ kind: 'record', record: { format: 'pdf' } });
    if (outcome.kind !== 'record') throw new Error('no record');
    const pages = await readPdfPages(outcome.record.image);
    const band = drawContextBand(outcome.record.contextBand, smallChatArea.width, 1).height;
    // The WhatsApp pixels of each page: below the Context Band on the first, all of the others.
    const content = pages.map((page, index) => {
      const top = index === 0 ? band : 0;
      return { height: page.height - top, firstRow: page.at(0, top).y, lastRow: page.at(0, page.height - 1).y, page, top };
    });
    return { pages, band, content };
  }

  test('break between messages, about one chat area each, covering every row once', async () => {
    const recorder = smallScreenRecorderFor(unevenDays);

    const outcome = await recorder.record({ kind: 'date-range', from: '2026-11-01', to: '2026-11-03' });

    const { content } = await pdfPages(outcome);
    const tops = itemTops(unevenDays);
    // The first page ends before the 70px message that would not fit: rows 0-69.
    expect(content[0]).toMatchObject({ firstRow: 0, lastRow: 69 });
    let next = 0;
    for (const page of content) {
      expect(page.firstRow).toBe(next);
      expect(tops.has(page.firstRow)).toBe(true);
      expect(page.height).toBeLessThanOrEqual(smallChatArea.height);
      for (let row = 0; row < page.height; row++) {
        expect(page.page.at(0, page.top + row)).toEqual({ x: 100, y: page.firstRow + row });
      }
      next = page.lastRow + 1;
    }
    expect(next).toBe(1155);
  });

  test('show the Context Band at the top of the first page only', async () => {
    const recorder = smallScreenRecorderFor(unevenDays);

    const outcome = await recorder.record({ kind: 'date-range', from: '2026-11-01', to: '2026-11-03' });

    const { pages, band, content } = await pdfPages(outcome);
    expect(band).toBeGreaterThan(0);
    expect(pages[0]!.colourCount(0, 0, pages[0]!.width, band)).toBeGreaterThan(1); // text is drawn on it
    expect(pages[0]!.at(0, band)).toEqual({ x: 100, y: 0 }); // the first day's divider follows it
    for (const page of content.slice(1)) {
      expect(page.page.height).toBe(page.height); // nothing above the WhatsApp pixels
    }
    expect(outcome).toMatchObject({
      record: { contextBand: ['Chat: Alice', 'Messages: 2026-11-01 to 2026-11-03', 'Taken: 2026-11-11 14:32 (UTC+01:00)'] },
    });
  });

  test('are the size the Chat looked on screen', async () => {
    const recorder = smallScreenRecorderFor(unevenDays);

    const outcome = await recorder.record({ kind: 'date-range', from: '2026-11-01', to: '2026-11-03' });

    // 300 CSS px at 96 to the inch is 225 PDF points (72 to the inch).
    const { pages } = await pdfPages(outcome);
    for (const page of pages) {
      expect(page.width).toBe(300);
      expect(page.size).toEqual({ width: 225, height: page.height * 0.75 });
    }
  });

  test('keep every device pixel on a high-density screen, with no gaps or repeats between pages', async () => {
    const page = createFakeWhatsAppPage({ chatName: 'Alice', chatArea: smallChatArea, chat: unevenDays });
    const camera = createFakeCamera({ viewport: smallViewport, page, devicePixelRatio: 2 });
    const recorder = createChatRecorder({ page, camera });

    const outcome = await recorder.record({ kind: 'date-range', from: '2026-11-01', to: '2026-11-03' });

    expect(outcome).toMatchObject({ kind: 'record', record: { format: 'pdf' } });
    if (outcome.kind !== 'record') return;
    const pages = await readPdfPages(outcome.record.image);
    const band = drawContextBand(outcome.record.contextBand, 600, 2).height;
    let next = 0;
    for (const [index, pdfPage] of pages.entries()) {
      expect(pdfPage.width).toBe(600);
      expect(pdfPage.size.width).toBe(225);
      for (let row = index === 0 ? band : 0; row < pdfPage.height; row++) {
        expect(pdfPage.at(0, row)).toEqual({ x: 200, y: next++ });
      }
    }
    expect(next).toBe(2310);
  });

  test('split a message only when it is taller than a whole page', async () => {
    // 1 Nov holds a 250px message (rows 80-330) between two 40px ones.
    const chat = twoHundredPixelDays(6);
    chat[0]!.messageHeights = [40, 250, 40];
    const recorder = smallScreenRecorderFor(chat);

    const outcome = await recorder.record({ kind: 'date-range', from: '2026-11-01', to: '2026-11-06' });

    const { content } = await pdfPages(outcome);
    expect(content.slice(0, 5).map(({ firstRow, lastRow }) => [firstRow, lastRow])).toEqual([
      [0, 79],
      [80, 179],
      [180, 279],
      [280, 369],
      [370, 449],
    ]);
  });
});

describe('progress while a Date Range is recorded', () => {
  test('is reported once per screen captured, with the day the Chat Record has reached', async () => {
    const recorder = recorderFor(sixDays);
    const progress: unknown[] = [];

    await recorder.record(
      { kind: 'date-range', from: '2026-11-02', to: '2026-11-04' },
      { onProgress: (p) => progress.push(p) },
    );

    // 2-4 Nov is 1620px: three screens of a 678px chat area. The first screen
    // shows 2 Nov and the start of 3 Nov, the second reaches 4 Nov.
    expect(progress).toEqual([
      { screensCaptured: 1, reachedDay: '2026-11-03' },
      { screensCaptured: 2, reachedDay: '2026-11-04' },
      { screensCaptured: 3, reachedDay: '2026-11-04' },
    ]);
  });
});

describe('one Chat Record at a time', () => {
  test('refuses a second start while one is running, and the first still finishes', async () => {
    const recorder = recorderFor(sixDays);
    const range = { kind: 'date-range', from: '2026-11-02', to: '2026-11-04' } as const;

    const first = recorder.record(range);
    const second = await recorder.record(range);

    expect(second).toMatchObject({ kind: 'failed', reason: 'busy' });
    expect(await first).toMatchObject({ kind: 'record', record: { span: { from: '2026-11-02', to: '2026-11-04' } } });
  });

  test('can start again once the previous one has ended', async () => {
    const recorder = recorderFor(sixDays);

    await recorder.record({ kind: 'date-range', from: '2026-11-02', to: '2026-11-02' }, { signal: AbortSignal.abort() });
    const again = await recorder.record({ kind: 'date-range', from: '2026-11-02', to: '2026-11-02' });

    expect(again.kind).toBe('record');
  });
});

describe('a Chat Record that fails part-way', () => {
  test('fails with "page not recognised", producing nothing, when WhatsApp Web changes mid-walk', async () => {
    const fake = createFakeWhatsAppPage({ chatName: 'Alice', chatArea, chat: sixDays });
    let screens = 0;
    const page: WhatsAppPage = {
      ...fake,
      loadedItems() {
        if (screens >= 1) throw new PageNotRecognisedError('no message list');
        return fake.loadedItems();
      },
    };
    const recorder = createChatRecorder({ page, camera: createFakeCamera({ viewport, page }) });

    const outcome = await recorder.record(
      { kind: 'date-range', from: '2026-11-02', to: '2026-11-04' },
      { onProgress: (p) => (screens = p.screensCaptured) },
    );

    expect(outcome).toEqual({
      kind: 'failed',
      reason: 'page-not-recognised',
      detail: "WhatsApp Web's page was not recognised: no message list",
    });
  });

  test('stops reporting progress after the Camera fails', async () => {
    const page = createFakeWhatsAppPage({ chatName: 'Alice', chatArea, chat: sixDays });
    const camera = createFakeCamera({ viewport, page, fails: new Error('Tab is hidden'), failsAfter: 1 });
    const recorder = createChatRecorder({ page, camera });
    const progress: number[] = [];

    const outcome = await recorder.record(
      { kind: 'date-range', from: '2026-11-02', to: '2026-11-04' },
      { onProgress: (p) => progress.push(p.screensCaptured) },
    );

    expect(outcome).toEqual({ kind: 'failed', reason: 'capture-failed', detail: 'Tab is hidden' });
    expect(progress).toEqual([1]);
  });
});

/** A Camera that counts its captures. */
function countingCamera(camera: Camera) {
  const counted = { captures: 0, capture: () => camera.capture().finally(() => counted.captures++) };
  return counted;
}

describe('cancelling a Chat Record', () => {
  test('part-way stops capturing and produces nothing', async () => {
    const page = createFakeWhatsAppPage({ chatName: 'Alice', chatArea, chat: sixDays });
    const camera = countingCamera(createFakeCamera({ viewport, page }));
    const recorder = createChatRecorder({ page, camera });
    const cancel = new AbortController();

    const outcome = await recorder.record(
      { kind: 'date-range', from: '2026-11-02', to: '2026-11-04' },
      { signal: cancel.signal, onProgress: ({ screensCaptured }) => screensCaptured === 1 && cancel.abort() },
    );

    expect(outcome).toEqual({ kind: 'cancelled' });
    expect(camera.captures).toBe(1); // a whole record takes three
  });

  test('while scrolling to the first day captures nothing', async () => {
    const fake = createFakeWhatsAppPage({ chatName: 'Alice', chatArea, chat: sixDays });
    const cancel = new AbortController();
    const page: WhatsAppPage = {
      ...fake,
      async scrollTo(top) {
        await fake.scrollTo(top);
        cancel.abort();
      },
    };
    const camera = countingCamera(createFakeCamera({ viewport, page }));
    const recorder = createChatRecorder({ page, camera });

    const outcome = await recorder.record(
      { kind: 'date-range', from: '2026-11-01', to: '2026-11-02' },
      { signal: cancel.signal },
    );

    expect(outcome).toEqual({ kind: 'cancelled' });
    expect(camera.captures).toBe(0);
  });

  test('after the last screen of a Chat Record long enough for a PDF produces no PDF', async () => {
    const recorder = smallScreenRecorderFor(twoHundredPixelDays(6));
    const cancel = new AbortController();

    // Six 200px days: 1200px, more than ten 100px chat areas. Cancel as the last day is reached.
    const outcome = await recorder.record(
      { kind: 'date-range', from: '2026-11-01', to: '2026-11-06' },
      { signal: cancel.signal, onProgress: ({ reachedDay }) => reachedDay === '2026-11-06' && cancel.abort() },
    );

    expect(outcome).toEqual({ kind: 'cancelled' });
  });

  test('before it starts captures nothing', async () => {
    const page = createFakeWhatsAppPage({ chatName: 'Alice', chatArea, chat: sixDays });
    const camera = countingCamera(createFakeCamera({ viewport, page }));
    const recorder = createChatRecorder({ page, camera });

    const outcome = await recorder.record({ kind: 'visible' }, { signal: AbortSignal.abort() });

    expect(outcome).toEqual({ kind: 'cancelled' });
    expect(camera.captures).toBe(0);
  });
});

/** Pixels below the band that are not exactly the chat area's screen pixels (at most 5 listed). */
function mismatchedChatPixels(image: Awaited<ReturnType<typeof readScreenPositions>>, band: number) {
  const mismatches: string[] = [];
  for (let y = 0; y < chatArea.height && mismatches.length < 5; y++) {
    for (let x = 0; x < chatArea.width && mismatches.length < 5; x++) {
      const at = image.at(x, band + y);
      if (at.x !== chatArea.left + x || at.y !== chatArea.top + y) mismatches.push(`(${x}, ${band + y})`);
    }
  }
  return mismatches;
}
