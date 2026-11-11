/** Messages between the content script and the background worker. */

/**
 * The name of the port a content script opens for one Chat Record's capture
 * session. The background worker attaches its debugger to the sender's tab
 * while the port is open and detaches when it closes (also when the page
 * goes away), see docs/adr/0004.
 */
export const captureSessionPortName = 'capture-session';

/** Content script → background, over a capture-session port. */
export type CaptureSessionRequest =
  /** Attach to this tab and keep it rendering as if visible; answered with `started` or `start-failed`. */
  | { type: 'start' }
  /** Capture the tab's viewport; answered with `captured` or `capture-failed` with the same `id`. */
  | { type: 'capture'; id: number };

/** Background → content script, over a capture-session port. */
export type CaptureSessionEvent =
  | { type: 'started' }
  | { type: 'start-failed'; error: string }
  /** `dataUrl` is a PNG of the viewport, in device pixels. */
  | { type: 'captured'; id: number; dataUrl: string }
  | { type: 'capture-failed'; id: number; error: string }
  /** Chrome ended the session (the debugger was detached); every later capture fails. */
  | { type: 'ended'; error: string };

/** Background → content script: the user clicked the toolbar icon on this tab. */
export interface OpenPanelRequest {
  type: 'open-panel';
}

export function isOpenPanelRequest(message: unknown): message is OpenPanelRequest {
  return (message as OpenPanelRequest | undefined)?.type === 'open-panel';
}
