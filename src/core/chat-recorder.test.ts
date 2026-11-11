import { describe, expect, test } from 'vitest';
import { CaptureNotAllowedError, type Camera } from './camera';
import { createChatRecorder, type ChatRecordOutcome } from './chat-recorder';
import { drawContextBand } from './context-band';
import { PageNotRecognisedError, type WhatsAppPage } from './whatsapp-page';
import { createFakeCamera, readScreenPositions } from './testing/fake-camera';
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
