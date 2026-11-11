import type { ContinuationPoint, FailureReason, RangeRequest } from '../core/chat-recorder';

/**
 * The Continuations waiting to be run, one per Chat at most: where each
 * Partial Chat Record stopped. Kept in `chrome.storage.session` (in memory
 * only, cleared when Chrome closes), so they survive reloading WhatsApp Web.
 * Only ids, days, times, the request and the failure reason are stored,
 * never message content or images.
 */
export interface ContinuationStore {
  /** The Continuation pending for the Chat named `chatName`, if any. */
  pending(chatName: string): Promise<ContinuationPoint | undefined>;
  /** Keeps `point` as its Chat's pending Continuation, replacing any older one. */
  save(point: ContinuationPoint): Promise<void>;
  /** Forgets the Chat's pending Continuation. */
  clear(chatName: string): Promise<void>;
}

/** The part of `chrome.storage.session` the store uses. */
export interface SessionStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export function createContinuationStore(area: SessionStorageArea = chrome.storage.session): ContinuationStore {
  const key = (chatName: string) => `continuation:${chatName}`;
  return {
    async pending(chatName) {
      const stored = (await area.get(key(chatName)))[key(chatName)];
      const point = readPoint(stored);
      return point?.chatName === chatName ? point : undefined;
    },
    async save(point) {
      await area.set({ [key(point.chatName)]: onlyIdsAndDates(point) });
    },
    async clear(chatName) {
      await area.remove(key(chatName));
    },
  };
}

/** A copy of `point` with only the fields a ContinuationPoint has, whatever else it carries. */
function onlyIdsAndDates(point: ContinuationPoint): ContinuationPoint {
  const { id, day, time } = point.lastMessage;
  const request: RangeRequest =
    point.request.kind === 'full-chat'
      ? { kind: 'full-chat' }
      : { kind: 'date-range', from: point.request.from, to: point.request.to };
  return {
    chatName: point.chatName,
    request,
    lastMessage: { id, day, ...(time === undefined ? {} : { time }) },
    reason: point.reason,
    partialFileName: point.partialFileName,
  };
}

const reasons: FailureReason[] = ['page-not-recognised', 'capture-not-allowed', 'capture-failed', 'busy'];

/** `stored` as a ContinuationPoint, or undefined if it isn't shaped like one. */
function readPoint(stored: unknown): ContinuationPoint | undefined {
  const value = stored as Partial<ContinuationPoint> | undefined;
  const isText = (text: unknown): text is string => typeof text === 'string';
  const message = value?.lastMessage;
  const request = value?.request;
  if (!value || !isText(value.chatName) || !isText(value.partialFileName)) return undefined;
  if (!reasons.includes(value.reason as FailureReason)) return undefined;
  if (typeof message !== 'object' || !isText(message.id) || !isText(message.day)) return undefined;
  if (message.time !== undefined && !isText(message.time)) return undefined;
  const requestKnown =
    request?.kind === 'full-chat' || (request?.kind === 'date-range' && isText(request.from) && isText(request.to));
  if (!requestKnown) return undefined;
  return onlyIdsAndDates(value as ContinuationPoint);
}
