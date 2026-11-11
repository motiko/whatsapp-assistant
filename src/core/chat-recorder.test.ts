import { describe, expect, test } from 'vitest';
import { CaptureNotAllowedError } from './camera';
import { createChatRecorder, type ChatRecordOutcome } from './chat-recorder';
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
    expect({ width: image.width, height: image.height }).toEqual({ width: 880, height: 678 });
    expect(image.at(0, 0)).toEqual({ x: 400, y: 60 });
    expect(image.at(879, 677)).toEqual({ x: 1279, y: 737 });
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
    expect({ width: image.width, height: image.height }).toEqual({ width: 1760, height: 1356 });
    expect(image.at(0, 0)).toEqual({ x: 800, y: 120 });
    expect(image.at(1759, 1355)).toEqual({ x: 2559, y: 1475 });
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

async function recordedImage(outcome: ChatRecordOutcome) {
  expect(outcome.kind).toBe('record');
  if (outcome.kind !== 'record') throw new Error('no record');
  return readScreenPositions(outcome.record.image);
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
    const image = await recordedImage(outcome);
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
