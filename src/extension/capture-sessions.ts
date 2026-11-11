import { captureSessionPortName, type CaptureSessionEvent, type CaptureSessionRequest } from './messages';

/** Only the content script on WhatsApp Web's top frame may open a capture session. */
const whatsAppWeb = 'https://web.whatsapp.com/';

/**
 * The background worker's side of capture sessions (see `debugger-camera.ts`
 * and docs/adr/0004): while a content script holds a capture-session port
 * open, Chrome's debugger is attached to its tab, with focus emulation on so
 * the tab keeps rendering, running animation frames and timers as if it were
 * visible even when it is in the background. Captures use
 * `Page.captureScreenshot`, which works for a background tab. Closing the
 * port (also by reloading or closing the page) detaches the debugger; if
 * Chrome detaches it first (the user cancels the "started debugging this
 * browser" bar, the tab is closed), the content script is told and every
 * later capture fails.
 */
export function serveCaptureSessions(): void {
  /** The open session's port, per tab with the debugger attached. */
  const sessions = new Map<number, chrome.runtime.Port>();
  /** Detaches still in progress, per tab; a new session waits for them. */
  const detaching = new Map<number, Promise<void>>();

  const detach = (tabId: number) => {
    const done = chrome.debugger
      .detach({ tabId })
      .catch(() => {}) // already detached
      .finally(() => detaching.delete(tabId));
    detaching.set(tabId, done);
    return done;
  };

  chrome.debugger.onDetach.addListener((source, reason) => {
    const tabId = source.tabId;
    if (tabId === undefined) return;
    const port = sessions.get(tabId);
    if (!port) return;
    sessions.delete(tabId);
    send(port, { type: 'ended', error: detachReason(reason) });
  });

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== captureSessionPortName) return;
    const tabId = port.sender?.tab?.id;
    let open = true;
    port.onDisconnect.addListener(() => {
      open = false;
      if (tabId !== undefined && sessions.get(tabId) === port) {
        sessions.delete(tabId);
        void detach(tabId);
      }
    });
    port.onMessage.addListener((request: CaptureSessionRequest) => {
      if (tabId === undefined || port.sender?.frameId !== 0 || !port.sender.url?.startsWith(whatsAppWeb)) {
        send(port, request.type === 'start'
          ? { type: 'start-failed', error: 'only the WhatsApp Web tab can be captured' }
          : { type: 'capture-failed', id: request.id, error: 'only the WhatsApp Web tab can be captured' });
        return;
      }
      if (request.type === 'start') void start(tabId, port, () => open);
      else void capture(tabId, port, request.id);
    });
  });

  async function start(tabId: number, port: chrome.runtime.Port, isOpen: () => boolean): Promise<void> {
    try {
      await detaching.get(tabId);
      if (sessions.has(tabId)) throw new Error('a Chat Record is already being made in this tab');
      await attach(tabId);
      if (!isOpen()) {
        await detach(tabId);
        return;
      }
      sessions.set(tabId, port);
      // Without this a background tab is "hidden": no animation frames,
      // timers about once a second, and WhatsApp Web may stop updating.
      await chrome.debugger.sendCommand({ tabId }, 'Emulation.setFocusEmulationEnabled', { enabled: true });
      send(port, { type: 'started' });
    } catch (error) {
      if (sessions.get(tabId) === port) {
        sessions.delete(tabId);
        await detach(tabId);
      }
      send(port, { type: 'start-failed', error: errorMessage(error) });
    }
  }

  /**
   * Attaches the debugger. If it is still attached from an earlier session
   * this worker has forgotten (it was restarted), detaches that one first.
   */
  async function attach(tabId: number): Promise<void> {
    try {
      await chrome.debugger.attach({ tabId }, '1.3');
    } catch (error) {
      if (!/already attached/i.test(errorMessage(error))) throw error;
      await chrome.debugger.detach({ tabId }).catch(() => {});
      await chrome.debugger.attach({ tabId }, '1.3');
    }
  }

  async function capture(tabId: number, port: chrome.runtime.Port, id: number): Promise<void> {
    try {
      if (sessions.get(tabId) !== port) throw new Error('the capture session has ended');
      const { data } = (await chrome.debugger.sendCommand({ tabId }, 'Page.captureScreenshot', {
        format: 'png',
        // Captures from the compositor's surface, which works for a background tab.
        fromSurface: true,
      })) as { data: string };
      send(port, { type: 'captured', id, dataUrl: `data:image/png;base64,${data}` });
    } catch (error) {
      send(port, { type: 'capture-failed', id, error: errorMessage(error) });
    }
  }
}

function detachReason(reason: string): string {
  switch (reason) {
    case 'canceled_by_user':
      return "capturing was stopped from Chrome's “started debugging this browser” bar";
    case 'target_closed':
      return 'the WhatsApp tab was closed';
    default:
      return `Chrome stopped the capture session (${reason})`;
  }
}

/** Posts to a port that may have closed meanwhile. */
function send(port: chrome.runtime.Port, event: CaptureSessionEvent): void {
  try {
    port.postMessage(event);
  } catch {
    // The page went away; nothing to tell.
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
