import { afterEach, describe, expect, test } from 'vitest';
import type { RecordProgress } from '../core/chat-recorder';
import { createRecordPanel, type CreateResult } from './record-panel';

afterEach(() => {
  document.body.replaceChildren();
});

/** What the panel was given for the Chat Record it started. */
interface StartedRun {
  onProgress: (progress: RecordProgress) => void;
  signal: AbortSignal;
  finish: (result: CreateResult) => void;
}

function render() {
  // Stands in for WhatsApp Web's page under the panel.
  const whatsApp = document.createElement('main');
  whatsApp.style.cssText = 'position: fixed; inset: 0;';
  document.body.append(whatsApp);
  const runs: StartedRun[] = [];
  const panel = createRecordPanel(document, {
    chatName: () => 'Alice',
    createChatRecord: (_range, run) =>
      new Promise<CreateResult>((resolve) => runs.push({ ...run, finish: resolve })),
    download: () => {},
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
  return { panel, root, runs, button, status, whatsAppGetsClicks, visible, start, settle };
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

  test('tells the user to keep the tab visible and leave it alone', () => {
    const { start, root } = render();

    start();

    expect(root.textContent).toContain("Keep this tab visible and don't scroll or click in WhatsApp");
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

    run.finish({ kind: 'failed', reason: 'capture-failed', detail: 'The WhatsApp tab was hidden while the Chat Record was being made' });
    await settle();

    expect(status()).toBe(
      "The screen couldn't be captured (The WhatsApp tab was hidden while the Chat Record was being made). Nothing was copied.",
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
