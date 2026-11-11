import { afterEach, describe, expect, test } from 'vitest';
import type { ContinuationPoint, RecordProgress } from '../core/chat-recorder';
import type { ContinuationStore } from '../extension/continuation-store';
import { createRecordPanel, type CreateResult, type PanelRequest, type RecordFile } from './record-panel';

afterEach(() => {
  document.body.replaceChildren();
});

/** What the panel was given for the Chat Record it started. */
interface StartedRun {
  request: PanelRequest;
  onProgress: (progress: RecordProgress) => void;
  signal: AbortSignal;
  finish: (result: CreateResult) => void;
}

/** Pending Continuations kept in memory, as `chrome.storage.session` would keep them. */
function memoryStore(points: ContinuationPoint[] = []) {
  const pending = new Map(points.map((point) => [point.chatName, point]));
  const store: ContinuationStore = {
    pending: async (chatName) => pending.get(chatName),
    save: async (point) => void pending.set(point.chatName, point),
    clear: async (chatName) => void pending.delete(chatName),
  };
  return { store, pending };
}

function render(options: { pending?: ContinuationPoint[] } = {}) {
  // Stands in for WhatsApp Web's page under the panel.
  const whatsApp = document.createElement('main');
  whatsApp.style.cssText = 'position: fixed; inset: 0;';
  document.body.append(whatsApp);
  const runs: StartedRun[] = [];
  const downloads: RecordFile[] = [];
  const continuations = memoryStore(options.pending);
  const panel = createRecordPanel(document, {
    chatName: () => 'Alice',
    createChatRecord: (request, run) =>
      new Promise<CreateResult>((resolve) => runs.push({ request, ...run, finish: resolve })),
    download: (file) => void downloads.push(file),
    continuations: continuations.store,
  });
  document.body.append(panel.button);
  const root = document.querySelector('whatsapp-assistant-panel')!.shadowRoot!;
  const button = (name: string) =>
    Array.from(root.querySelectorAll('button')).find((b) => b.textContent === name);
  const status = () => root.querySelector('[role="status"]')!.textContent ?? '';
  /** Whether WhatsApp Web, not the extension, would get a click in the middle of the screen. */
  const whatsAppGetsClicks = () => document.elementFromPoint(640, 400) === whatsApp;
  const visible = (element: Element) => element.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  const start = () => {
    panel.open();
    button('Today')!.click();
    button('Create Chat Record')!.click();
    return runs.at(-1)!;
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve));
  return { panel, root, runs, downloads, continuations: continuations.pending, button, status, whatsAppGetsClicks, visible, start, settle };
}

describe('the panel while a Chat Record is being made', () => {
  test('shows the screens captured and the day reached', () => {
    const { start, status } = render();

    const run = start();
    run.onProgress({ screensCaptured: 1, reachedDay: '2026-11-03' });
    run.onProgress({ screensCaptured: 3, reachedDay: '2026-11-04' });

    expect(status()).toMatch(/3 screens/);
    expect(status()).toContain(new Date(2026, 10, 4).toLocaleDateString(undefined, { dateStyle: 'medium' }));
  });

  test("tells the user they may switch tabs, to leave WhatsApp alone, and to expect Chrome's debugging bar", () => {
    const { start, root } = render();

    start();

    const notice = root.querySelector('.notice')!;
    expect(notice.checkVisibility()).toBe(true);
    expect(notice.textContent).toBe(
      "You can switch to other tabs meanwhile. Don't scroll or click in WhatsApp, and don't cancel Chrome's “started debugging this browser” bar, until the Chat Record is done.",
    );
    expect(root.textContent).not.toContain('Keep this tab visible');
  });

  test('locks WhatsApp Web against clicks until the Chat Record is done', async () => {
    const { start, whatsAppGetsClicks, settle } = render();
    expect(whatsAppGetsClicks()).toBe(true);

    const run = start();
    expect(whatsAppGetsClicks()).toBe(false);

    run.finish({ kind: 'no-messages', from: '2026-11-11', to: '2026-11-11' });
    await settle();
    expect(whatsAppGetsClicks()).toBe(true);
  });

  test('can be cancelled, which stops the run and says nothing was made', async () => {
    const { start, button, status, whatsAppGetsClicks, settle } = render();
    const run = start();

    button('Cancel')!.click();
    expect(run.signal.aborted).toBe(true);
    run.finish({ kind: 'cancelled' });
    await settle();

    expect(status()).toBe('Cancelled. No Chat Record was made.');
    expect(button('Cancel')?.checkVisibility()).toBeFalsy();
    expect(button('Create Chat Record')!.disabled).toBe(false);
    expect(whatsAppGetsClicks()).toBe(true);
  });

  test('cannot start a second Chat Record, even when opened again', () => {
    const { start, panel, runs, button, status } = render();
    const run = start();
    run.onProgress({ screensCaptured: 2, reachedDay: '2026-11-04' });

    panel.open();
    button('Create Chat Record')!.click();

    expect(runs).toHaveLength(1);
    expect(status()).toMatch(/2 screens/);
  });

  test('stays open, so Cancel stays in reach, when Escape is pressed', () => {
    const { start, button } = render();
    start();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(button('Cancel')!.checkVisibility()).toBe(true);
  });

  test('says clearly when capture failed part-way, and that nothing was made', async () => {
    const { start, status, settle } = render();
    const run = start();

    run.finish({ kind: 'failed', reason: 'capture-failed', detail: 'the WhatsApp tab was closed or reloaded' });
    await settle();

    expect(status()).toBe("The screen couldn't be captured (the WhatsApp tab was closed or reloaded). Nothing was copied.");
  });

  test("says why when Chrome doesn't let the extension capture the tab, without asking for a toolbar click", async () => {
    const { start, status, settle } = render();
    const run = start();

    run.finish({ kind: 'failed', reason: 'capture-not-allowed', detail: 'Another debugger is already attached to the tab' });
    await settle();

    expect(status()).toBe(
      "Chrome didn't let this extension capture this tab (Another debugger is already attached to the tab). Nothing was copied.",
    );
  });
});

describe('the extension UI in captured pixels', () => {
  test('is hidden, lock and progress included, while the screen is captured', () => {
    const { start, panel, root, visible } = render();
    start();
    const shown = () => Array.from(root.querySelectorAll('section, .lock')).filter(visible);
    expect(shown()).toHaveLength(2);

    const restore = panel.hide();
    expect(shown()).toHaveLength(0);
    expect(visible(panel.button)).toBe(false);

    restore();
    expect(shown()).toHaveLength(2);
  });

  test('keeps WhatsApp Web locked while it is hidden for a capture', () => {
    const { start, panel, whatsAppGetsClicks } = render();
    start();

    panel.hide();

    expect(whatsAppGetsClicks()).toBe(false);
  });
});

describe('Partial Chat Records and Continue in the panel', () => {
  const point: ContinuationPoint = {
    chatName: 'Alice',
    request: { kind: 'date-range', from: '2026-01-01', to: '2026-03-31' },
    lastMessage: { id: 'm-1', day: '2026-03-14', time: '14:32' },
    reason: 'capture-failed',
    partialFileName: 'Chat history - Alice - 2026-01-01 to 2026-03-14 (partial).png',
  };
  const day = (year: number, month: number, date: number) =>
    new Date(year, month - 1, date).toLocaleDateString(undefined, { dateStyle: 'medium' });
  const continueLabel = `Continue from ${day(2026, 3, 14)} 14:32`;
  const png = (name: string): RecordFile => ({ name, image: new Blob([], { type: 'image/png' }) });
  const pdf = (name: string): RecordFile => ({ name, image: new Blob([], { type: 'application/pdf' }) });
  const partialOf = (continuation: ContinuationPoint) => ({ continuation, reason: 'capture-failed' as const, detail: 'Tab is hidden' });
  /** Whether the panel shows any Continue button. */
  const offersContinue = (root: ShadowRoot) =>
    Array.from(root.querySelectorAll('button')).some((b) => b.textContent?.startsWith('Continue from') && b.checkVisibility());

  test('offers no Continue when no Continuation is pending for the open Chat', async () => {
    const { panel, root, settle } = render({ pending: [{ ...point, chatName: 'Bob' }] });

    panel.open();
    await settle();

    expect(offersContinue(root)).toBe(false);
  });

  test('offers Continue from the last message captured when a Continuation is pending for the open Chat, and runs it', async () => {
    const { panel, button, runs, settle } = render({ pending: [point] });

    panel.open();
    await settle();
    button(continueLabel)!.click();
    button('Create Chat Record')!.click();

    expect(runs.at(-1)!.request).toEqual({ kind: 'continuation', from: point });
  });

  test('goes back to a Date Range when a preset is chosen after Continue', async () => {
    const { panel, button, runs, settle } = render({ pending: [point] });
    panel.open();
    await settle();

    button(continueLabel)!.click();
    button('Today')!.click();
    button('Create Chat Record')!.click();

    expect(runs.at(-1)!.request.kind).toBe('date-range');
  });

  test('confirms a partial save to the clipboard, offers its Download, and then offers Continue', async () => {
    const { start, status, button, continuations, settle } = render();
    const run = start();

    run.finish({
      kind: 'made',
      file: png(point.partialFileName),
      clipboard: { copied: true },
      partial: partialOf(point),
    });
    await settle();

    expect(status()).toBe(
      `The run failed part-way (the screen couldn't be captured: Tab is hidden). What was captured, up to ${day(2026, 3, 14)} 14:32, was copied to the clipboard as a partial Chat Record. Click “${continueLabel}” to record the rest.`,
    );
    expect(button('Download PNG')!.checkVisibility()).toBe(true);
    expect(continuations.get('Alice')).toEqual(point);
    expect(button(continueLabel)?.checkVisibility()).toBe(true);
  });

  test('downloads a partial PDF straight away and confirms it', async () => {
    const { start, status, downloads, settle } = render();
    const run = start();
    const name = 'Chat history - Alice - 2026-01-01 to 2026-03-14 (partial).pdf';

    run.finish({ kind: 'made-pdf', file: pdf(name), partial: partialOf({ ...point, partialFileName: name }) });
    await settle();

    expect(downloads.map((file) => file.name)).toEqual([name]);
    expect(status()).toContain(`was downloaded to your Downloads folder as a partial Chat Record, “${name}”`);
  });

  test('forgets the Continuation once it has finished, and downloads and confirms a Gap Record', async () => {
    const { panel, button, runs, status, downloads, continuations, root, settle } = render({ pending: [point] });
    panel.open();
    await settle();
    button(continueLabel)!.click();
    button('Create Chat Record')!.click();
    const gapName = 'Chat history - Alice - 2026-03-14 (gap).png';

    runs.at(-1)!.finish({
      kind: 'made',
      file: png('Chat history - Alice - 2026-03-14 to 2026-03-31.png'),
      clipboard: { copied: true },
      gap: { kind: 'record', file: png(gapName) },
    });
    await settle();

    expect(continuations.has('Alice')).toBe(false);
    expect(offersContinue(root)).toBe(false);
    expect(downloads.map((file) => file.name)).toEqual([gapName]);
    expect(status()).toBe(
      `Chat Record copied to the clipboard as a PNG. Some messages between it and the partial Chat Record had been missed; they were downloaded separately as “${gapName}”.`,
    );
  });

  test('warns when messages missed between the records could not be recorded', async () => {
    const { start, status, settle } = render();
    const run = start();

    run.finish({
      kind: 'made',
      file: png('Chat history - Alice - 2026-03-14 to 2026-03-31.png'),
      clipboard: { copied: true },
      gap: { kind: 'failed', detail: 'Tab is hidden' },
    });
    await settle();

    expect(status()).toContain(
      "Some messages between it and the partial Chat Record were missed and couldn't be recorded (Tab is hidden). Record those days again to have them.",
    );
  });

  test('keeps the Continuation when it fails without capturing anything', async () => {
    const { panel, button, runs, continuations, settle } = render({ pending: [point] });
    panel.open();
    await settle();
    button(continueLabel)!.click();
    button('Create Chat Record')!.click();

    runs.at(-1)!.finish({ kind: 'failed', reason: 'capture-failed', detail: 'Tab is hidden' });
    await settle();

    expect(continuations.get('Alice')).toEqual(point);
    expect(button(continueLabel)?.checkVisibility()).toBe(true);
  });
});
