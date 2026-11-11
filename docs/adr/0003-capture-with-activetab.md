# Capture the tab with activeTab, not access to all sites

_Superseded by [ADR-0004](0004-capture-with-the-debugger.md): capture now goes through `chrome.debugger`, so the tab can be in the background and no toolbar click is needed._

`chrome.tabs.captureVisibleTab` only works when the extension holds `<all_urls>` or an `activeTab` grant for the tab; a host permission for `https://web.whatsapp.com/*` alone is refused ("Either the '<all_urls>' or 'activeTab' permission is required", verified in Chromium). We keep host access limited to WhatsApp Web and use `activeTab`, which the user grants by clicking the extension's toolbar icon on the WhatsApp Web tab (it lasts until the tab is reloaded or navigated away). The cost is one extra click per tab load; clicking the in-page header button does not grant `activeTab`. Switching to `<all_urls>` would remove that click but would ask Chrome for access to every site, which the spec rules out.
