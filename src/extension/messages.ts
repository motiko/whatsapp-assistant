/** Messages between the content script and the background worker. */

/** Content script → background: capture the visible part of the sender's tab. */
export interface CaptureVisibleTabRequest {
  type: 'capture-visible-tab';
}

export type CaptureVisibleTabResponse =
  | { ok: true; dataUrl: string }
  | { ok: false; notAllowed: boolean; error: string };

/** Background → content script: the user clicked the toolbar icon on this tab. */
export interface OpenPanelRequest {
  type: 'open-panel';
}

export function isCaptureVisibleTabRequest(message: unknown): message is CaptureVisibleTabRequest {
  return (message as CaptureVisibleTabRequest | undefined)?.type === 'capture-visible-tab';
}

export function isOpenPanelRequest(message: unknown): message is OpenPanelRequest {
  return (message as OpenPanelRequest | undefined)?.type === 'open-panel';
}
