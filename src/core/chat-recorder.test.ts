import { describe, expect, test } from 'vitest';
import { CaptureNotAllowedError } from './camera';
import { createChatRecorder } from './chat-recorder';
import { PageNotRecognisedError, type WhatsAppPage } from './whatsapp-page';
import { createFakeCamera, readScreenPositions } from './testing/fake-camera';
import { createFakeWhatsAppPage } from './testing/fake-whatsapp-page';

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
      chatName: () => {
        throw new PageNotRecognisedError('no Chat header');
      },
      chatArea: () => chatArea,
    };
    const recorder = createChatRecorder({
      page: unrecognisedPage,
      camera: createFakeCamera({ viewport }),
    });

    const outcome = await recorder.record({ kind: 'visible' });

    expect(outcome).toMatchObject({ kind: 'failed', reason: 'page-not-recognised' });
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
