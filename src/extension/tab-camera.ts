import { CaptureNotAllowedError, type Camera } from '../core/camera';
import type { CaptureVisibleTabRequest, CaptureVisibleTabResponse } from './messages';

/**
 * Chrome allows `captureVisibleTab` about twice a second
 * (MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND); captures are spaced at least
 * this far apart so a multi-screen Chat Record is not refused part-way.
 */
const minCaptureIntervalMs = 550;

/**
 * The real Camera: captures the visible tab through the background worker.
 * The extension's own UI is hidden while the picture is taken, so only
 * WhatsApp Web's pixels are captured. Captures are paced to Chrome's limit.
 */
export function createTabCamera(options: { hideOwnUi: () => () => void }): Camera {
  let lastCaptureAt = -Infinity;
  return {
    async capture() {
      const wait = lastCaptureAt + minCaptureIntervalMs - performance.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      lastCaptureAt = performance.now();
      const restore = options.hideOwnUi();
      let response: CaptureVisibleTabResponse;
      try {
        await nextPaint();
        const request: CaptureVisibleTabRequest = { type: 'capture-visible-tab' };
        response = await chrome.runtime.sendMessage(request);
      } finally {
        restore();
      }
      if (!response.ok) {
        throw response.notAllowed ? new CaptureNotAllowedError(response.error) : new Error(response.error);
      }
      const bitmap = await createImageBitmap(dataUrlToBlob(response.dataUrl));
      // The capture covers the viewport in device pixels; derive the ratio
      // from it so browser zoom is accounted for too.
      return { bitmap, devicePixelRatio: bitmap.width / window.innerWidth };
    },
  };
}

/** Resolves after the browser has painted the current DOM state. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64 = ''] = dataUrl.split(',', 2);
  const type = /data:([^;]+)/.exec(header ?? '')?.[1] ?? 'image/png';
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type });
}
