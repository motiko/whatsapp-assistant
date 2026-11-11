import { afterEach, describe, expect, test } from 'vitest';
import type { Camera } from '../core/camera';
import { whileTabVisible } from './visible-tab-camera';

const screenshot = async () => ({ bitmap: await createImageBitmap(new ImageData(1, 1)), devicePixelRatio: 1 });

/** A Camera whose captures wait until `finish` is called, so the tab can be hidden mid-capture. */
function slowCamera() {
  const pending: (() => void)[] = [];
  const camera: Camera = {
    capture: () => new Promise((resolve) => pending.push(() => resolve(screenshot()))),
  };
  return { camera, finish: () => pending.splice(0).forEach((resolve) => resolve()) };
}

function setTabHidden(hidden: boolean) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  setTabHidden(false);
  delete (document as { visibilityState?: unknown }).visibilityState;
  delete (document as { hidden?: unknown }).hidden;
});

describe('a Camera used while the tab must stay visible', () => {
  test('captures as usual while the tab stays visible', async () => {
    const guarded = whileTabVisible(document, { capture: screenshot });

    await expect(guarded.camera.capture()).resolves.toMatchObject({ devicePixelRatio: 1 });
    guarded.release();
  });

  test('fails every capture after the tab was hidden, even once it is visible again', async () => {
    const guarded = whileTabVisible(document, { capture: screenshot });
    await guarded.camera.capture();

    setTabHidden(true);
    setTabHidden(false);

    await expect(guarded.camera.capture()).rejects.toThrow('The WhatsApp tab was hidden');
    guarded.release();
  });

  test('fails a capture during which the tab was hidden', async () => {
    const slow = slowCamera();
    const guarded = whileTabVisible(document, slow.camera);

    const capture = guarded.camera.capture();
    setTabHidden(true);
    setTabHidden(false);
    slow.finish();

    await expect(capture).rejects.toThrow('The WhatsApp tab was hidden');
    guarded.release();
  });

  test('fails at once when the tab is already hidden', async () => {
    setTabHidden(true);
    const guarded = whileTabVisible(document, { capture: screenshot });

    await expect(guarded.camera.capture()).rejects.toThrow('The WhatsApp tab was hidden');
    guarded.release();
  });
});
