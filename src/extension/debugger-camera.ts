import { CaptureNotAllowedError, type Camera } from '../core/camera';
import { captureSessionPortName, type CaptureSessionEvent, type CaptureSessionRequest } from './messages';

/**
 * The real Camera: captures the WhatsApp tab through the background worker,
 * which attaches Chrome's debugger to the tab for one Chat Record (`start`
 * to `stop`) and captures with `Page.captureScreenshot`. That works while the
 * tab is in the background, and the worker keeps the tab rendering as if it
 * were visible meanwhile (see docs/adr/0004). The extension's own UI is
 * hidden while each picture is taken, so only WhatsApp Web's pixels are
 * captured.
 */
export function createDebuggerCamera(options: { hideOwnUi: () => () => void }): Camera {
  let session: CaptureSession | undefined;
  return {
    async start() {
      session?.close();
      session = undefined;
      session = await openCaptureSession();
      // Attaching makes Chrome slide in its "started debugging this browser"
      // bar, which shrinks the viewport about 0.1 s later; the chat area is
      // measured after this resolves, so wait for the layout to settle.
      await viewportSettled();
    },
    async stop() {
      session?.close();
      session = undefined;
    },
    async capture() {
      if (!session) throw new Error('the capture session was not started');
      const restore = options.hideOwnUi();
      let dataUrl: string;
      try {
        await nextPaint();
        dataUrl = await session.capture();
      } finally {
        restore();
      }
      const bitmap = await createImageBitmap(dataUrlToBlob(dataUrl));
      // The capture covers the viewport in device pixels; derive the ratio
      // from it so browser zoom is accounted for too.
      return { bitmap, devicePixelRatio: bitmap.width / window.innerWidth };
    },
  };
}

interface CaptureSession {
  /** A PNG data URL of the viewport. Rejects once the session has ended. */
  capture(): Promise<string>;
  /** Ends the session; the background worker detaches its debugger. */
  close(): void;
}

/** Opens a capture session; rejects with `CaptureNotAllowedError` if Chrome refuses to attach. */
function openCaptureSession(): Promise<CaptureSession> {
  const port = chrome.runtime.connect({ name: captureSessionPortName });
  const pending = new Map<number, { resolve: (dataUrl: string) => void; reject: (error: Error) => void }>();
  let nextId = 0;
  let ended: Error | undefined;
  const end = (error: Error) => {
    ended ??= error;
    for (const { reject } of pending.values()) reject(ended);
    pending.clear();
  };
  const post = (request: CaptureSessionRequest) => port.postMessage(request);
  const session: CaptureSession = {
    capture() {
      if (ended) return Promise.reject(ended);
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        post({ type: 'capture', id });
      });
    },
    close() {
      end(new Error('the capture session was closed'));
      port.disconnect();
    },
  };
  return new Promise((resolve, reject) => {
    port.onMessage.addListener((event: CaptureSessionEvent) => {
      switch (event.type) {
        case 'started':
          resolve(session);
          break;
        case 'start-failed':
          end(new CaptureNotAllowedError(event.error));
          port.disconnect();
          reject(ended);
          break;
        case 'captured':
          pending.get(event.id)?.resolve(event.dataUrl);
          pending.delete(event.id);
          break;
        case 'capture-failed':
          pending.get(event.id)?.reject(new Error(event.error));
          pending.delete(event.id);
          break;
        case 'ended':
          end(new Error(event.error));
          break;
      }
    });
    port.onDisconnect.addListener(() => {
      end(new Error("the extension's background worker stopped capturing"));
      reject(ended);
    });
    post({ type: 'start' });
  });
}

/** How long the viewport must keep its size to count as settled, and the longest to wait. */
const viewportQuietMs = 500;
const viewportMaxWaitMs = 3000;

/** Resolves once the viewport has kept its size for `viewportQuietMs` (at most `viewportMaxWaitMs`). */
function viewportSettled(): Promise<void> {
  return new Promise((resolve) => {
    let quiet: ReturnType<typeof setTimeout>;
    const done = () => {
      clearTimeout(quiet);
      clearTimeout(cap);
      window.removeEventListener('resize', restart);
      resolve();
    };
    const restart = () => {
      clearTimeout(quiet);
      quiet = setTimeout(done, viewportQuietMs);
    };
    const cap = setTimeout(done, viewportMaxWaitMs);
    window.addEventListener('resize', restart);
    restart();
  });
}

/**
 * Resolves after the browser has painted the current DOM state (the
 * extension's UI hidden), or after a short wait if no frame comes.
 */
function nextPaint(): Promise<void> {
  const frame = () =>
    new Promise<void>((resolve) => {
      const done = () => {
        cancelAnimationFrame(raf);
        clearTimeout(timer);
        resolve();
      };
      const raf = requestAnimationFrame(done);
      const timer = setTimeout(done, 100);
    });
  return frame().then(frame);
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64 = ''] = dataUrl.split(',', 2);
  const type = /data:([^;]+)/.exec(header ?? '')?.[1] ?? 'image/png';
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type });
}
