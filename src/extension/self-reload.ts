declare const __BUILD_ID__: string;

/** Set before reloading for a new build: WhatsApp Web tabs are reloaded once the new worker starts. */
const reloadTabsKey = 'dev.reloadWhatsAppTabs';
/** How often to look for a new build while the worker is awake. */
const checkEveryMs = 2000;

/**
 * Picks up new builds of the unpacked extension without a click: every build
 * writes its id to `build-id.txt` (see wxt.config.ts). When the file no
 * longer matches the running build, the extension reloads itself, then
 * reloads WhatsApp Web's tabs so they run the new content script. Never
 * while a Chat Record is being made (`busy`): it waits until that is done.
 *
 * Checked every 2 s while the worker is awake (the Telegram bot's polling
 * keeps it awake), on every alarm, and at startup. A worker Chrome has put
 * to sleep notices within a minute.
 */
export function serveSelfReload(options: { busy(): boolean }): void {
  // Only an unpacked extension reads its files from the folder builds go to.
  if ('update_url' in chrome.runtime.getManifest()) return;

  void reloadWhatsAppTabsIfAsked();

  let reloading = false;
  async function check(): Promise<void> {
    if (reloading || options.busy()) return;
    let onDisk: string;
    try {
      // Written after the build, so it isn't in WXT's typed paths.
      const response = await fetch(new URL('/build-id.txt', location.origin), { cache: 'no-store' });
      onDisk = (await response.text()).trim();
    } catch {
      return; // No build-id.txt (WXT's dev server): nothing to compare.
    }
    if (!onDisk || onDisk === __BUILD_ID__ || options.busy()) return;
    reloading = true;
    console.info('[self-reload] new build on disk, reloading', __BUILD_ID__, '→', onDisk);
    await chrome.storage.local.set({ [reloadTabsKey]: true });
    chrome.runtime.reload();
  }

  setInterval(() => void check(), checkEveryMs);
  chrome.alarms.onAlarm.addListener(() => void check());
  void check();
}

async function reloadWhatsAppTabsIfAsked(): Promise<void> {
  const asked = (await chrome.storage.local.get(reloadTabsKey))[reloadTabsKey];
  if (!asked) return;
  await chrome.storage.local.remove(reloadTabsKey);
  // The old content script lost its connection to the extension; only a reload brings the new one.
  const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  for (const tab of tabs) if (tab.id !== undefined) await chrome.tabs.reload(tab.id).catch(() => {});
}
