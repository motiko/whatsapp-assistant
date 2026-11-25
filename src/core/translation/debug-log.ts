import type { StorageArea } from './store';

/** One step auto-translation took, for the options page's debug log. */
export interface DebugEntry {
  at: number;
  source: DebugSource;
  event: string;
  detail?: Record<string, unknown>;
}

/** Each side writes its own storage key, so the two never overwrite each other's entries. */
export type DebugSource = 'whatsapp' | 'bot';

/** Entries kept per side. */
const maxEntries = 60;

export const debugLogKeys: Record<DebugSource, string> = {
  whatsapp: 'translation.debug.whatsapp',
  bot: 'translation.debug.bot',
};

export type DebugLogger = (event: string, detail?: Record<string, unknown>) => void;

/**
 * A short log of what auto-translation did, kept in `chrome.storage.local`
 * for the options page. Holds Chat names and masked message ids, never
 * message text. Writing never fails the caller.
 */
export function createDebugLog(area: StorageArea, source: DebugSource, now: () => number = () => Date.now()): DebugLogger {
  const key = debugLogKeys[source];
  let queue: Promise<unknown> = Promise.resolve();
  return (event, detail) => {
    const entry: DebugEntry = { at: now(), source, event, ...(detail ? { detail } : {}) };
    queue = queue
      .then(async () => {
        const stored = (await area.get([key]))[key];
        const entries = Array.isArray(stored) ? (stored as DebugEntry[]) : [];
        await area.set({ [key]: [...entries, entry].slice(-maxEntries) });
      })
      .catch(() => {});
  };
}

/** Both sides' entries, oldest first. */
export async function readDebugLog(area: StorageArea): Promise<DebugEntry[]> {
  const stored = await area.get(Object.values(debugLogKeys));
  return Object.values(debugLogKeys)
    .flatMap((key) => (Array.isArray(stored[key]) ? (stored[key] as DebugEntry[]) : []))
    .sort((a, b) => a.at - b.at);
}

export async function clearDebugLog(area: StorageArea): Promise<void> {
  await area.remove(Object.values(debugLogKeys));
}

/**
 * A WhatsApp message id without the phone numbers in it:
 * `true_491512345678@c.us_3EB0C4F1A2` → `true_…@c.us_…F1A2`.
 */
export function maskId(id: string): string {
  const match = /^(true|false)_[^@]*(@[a-z.]+)?_?(.*)$/.exec(id);
  // Newer pages: just the message's key, which holds no phone number.
  if (!match) return id.length > 8 ? `…${id.slice(-6)}` : id;
  return `${match[1]}_…${match[2] ?? ''}_…${(match[3] ?? '').slice(-4)}`;
}

export function formatDebugLog(entries: readonly DebugEntry[]): string {
  return entries
    .map((entry) => {
      const time = new Date(entry.at).toLocaleTimeString(undefined, { hour12: false });
      const detail = entry.detail ? ` ${JSON.stringify(entry.detail)}` : '';
      return `${time} [${entry.source}] ${entry.event}${detail}`;
    })
    .join('\n');
}
