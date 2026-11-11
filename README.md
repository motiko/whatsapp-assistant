# WhatsApp Assistant

A personal Chrome extension that runs on [WhatsApp Web](https://web.whatsapp.com) and makes
**Chat Records**: faithful images of a Chat, made of WhatsApp Web's own pixels
(see [GLOSSARY.md](GLOSSARY.md) and [docs/adr/](docs/adr/)).

Current state ([#2](https://github.com/motiko/whatsapp-assistant/issues/2) walking skeleton,
[#5](https://github.com/motiko/whatsapp-assistant/issues/5) Date Ranges): a button in the open
Chat's header opens a panel where you pick a **Date Range** (From/To pickers or the Today,
Last 7 days and Last 30 days presets). **Create Chat Record** scrolls the Chat to the range itself,
captures as many screens as needed and copies them, stitched, to the clipboard as one PNG. Full
Chat, "Read more" expansion, progress and Cancel, the Context Band and PDF output come in later
tickets of [#1](https://github.com/motiko/whatsapp-assistant/issues/1).

## Requirements

- Node 24 and npm
- Google Chrome (or Chromium)
- For tests: Playwright's Chromium build. `npm install` pins `playwright` to the version that
  matches the browser build; if it is missing, run `npx playwright install chromium`.

## Build

```sh
npm install
npm run build        # writes the unpacked extension to .output/chrome-mv3
```

`npm run dev` starts WXT's dev mode (rebuilds and reloads on change in a separate Chrome profile).

## Load it unpacked in Chrome

1. Run `npm run build`.
2. Open `chrome://extensions` and switch on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `.output/chrome-mv3` folder in this repo.
4. Open or reload https://web.whatsapp.com.
5. After rebuilding, click the reload icon on the extension's card, then reload WhatsApp Web.

### Allowing capture (once per WhatsApp Web tab load)

Chrome only lets an extension capture a tab if it has access to *all* sites or the user has
invoked it on that tab (`activeTab`). To keep access limited to WhatsApp Web, this extension uses
`activeTab`: **click the WhatsApp Assistant icon in Chrome's toolbar once** on the WhatsApp Web tab
(pin it from the puzzle-piece menu). That grants capture for the tab until it is reloaded or
navigated away, and also opens the panel. If you skip it, the panel tells you to do it.

## Use

1. Open a Chat. A camera button appears in the Chat header, left of WhatsApp's own icons.
2. Click it. The panel names the Chat the Chat Record will be of.
3. Pick **From** and **To** (To starts at today), or click **Today**, **Last 7 days** or
   **Last 30 days**. Days are whole days in your computer's timezone, both ends included, as
   WhatsApp Web's date dividers show them. From can't be after To, and neither in the future.
4. Click **Create Chat Record** and leave the tab alone (visible, no scrolling) until it is done.
   The extension scrolls to the range, captures screen by screen (at most about two per second,
   Chrome's limit) and copies one PNG to the clipboard: from the top of the first day's date
   divider to the bottom of the last message of the last day, cropped to the chat area (no Chat
   list, header, message box, scrollbar or extension UI). A range with no messages says
   "No messages between X and Y" and copies nothing.

## Tests

```sh
npm test             # Vitest in browser mode (headless Playwright Chromium), runs once
npm run test:watch   # re-runs on change
npm run compile      # TypeScript type check
```

Tests sit at two seams (see the spec's Testing Decisions in
[#1](https://github.com/motiko/whatsapp-assistant/issues/1)):

- **Chat Recorder** (`src/core/chat-recorder.test.ts`): driven through its public interface with a
  fake WhatsApp Page (`src/core/testing/fake-whatsapp-page.ts`) and a fake Camera
  (`src/core/testing/fake-camera.ts`) whose generated pixels encode their own screen position, so
  tests can check exactly which part of the screen ends up where in a Chat Record.
- **Date Range fields** (`src/ui/date-range-fields.test.ts`): pickers, presets and validation,
  driven through the DOM with a fixed "today".
- **WhatsApp Web adapter** (`src/whatsapp-web/*.test.ts`): run against page snapshots in
  `src/whatsapp-web/fixtures/`, rendered in a real 1280x800 frame. **These snapshots are currently
  synthetic** (hand-written to resemble WhatsApp Web); see
  [the fixtures README](src/whatsapp-web/fixtures/README.md) for how to replace them with real,
  scrubbed ones.

## Code layout

| Path | Module |
| --- | --- |
| `src/core/chat-recorder.ts` | **Chat Recorder**: request (a Date Range, or the visible chat area) in, outcome out (a Chat Record, *no messages*, or *failed* with a reason). Range resolution, the scroll-and-capture loop, cropping and stitching. No Chrome or WhatsApp knowledge. |
| `src/core/whatsapp-page.ts` | **WhatsApp Page** interface (Chat name, chat area, scroll position/height, scrolling, loaded date dividers and messages) and `PageNotRecognisedError` |
| `src/core/camera.ts` | **Camera** interface (visible-tab bitmap + device pixel ratio) and `CaptureNotAllowedError` |
| `src/whatsapp-web/` | **WhatsApp Web adapter**: the only code that knows WhatsApp Web's page. All selectors are in `selectors.ts`; reading divider labels ("Today", weekdays, locale dates) is in `divider-dates.ts`. |
| `src/extension/` | Chrome-side pieces: the tab Camera, clipboard output, messages to the background worker |
| `src/ui/record-panel.ts` | Header button and panel |
| `src/ui/date-range-fields.ts` | The panel's From/To pickers, presets and validation |
| `src/entrypoints/` | WXT entry points: content script (wiring) and background worker (tab capture) |

## Permissions and privacy

- `host_permissions`: `https://web.whatsapp.com/*` only.
- `activeTab`: needed for `chrome.tabs.captureVisibleTab` (see above).
- `clipboardWrite`: lets the content script put the PNG on the clipboard.

The extension makes no network requests and stores nothing; Chat Records exist only on your clipboard.

## Manual smoke checklist (walking skeleton)

Needs a logged-in WhatsApp Web, so it is not automated. Use a fresh `npm run build`, loaded unpacked.

- [ ] Open https://web.whatsapp.com and a one-to-one Chat: the camera button appears in the Chat header.
- [ ] Open a group Chat: the button appears there too.
- [ ] Switch between a few Chats (without reloading): the button is in each Chat's header, exactly once.
- [ ] Click the button: the panel opens next to it and names the open Chat. Escape or clicking outside closes it.
- [ ] Before clicking the toolbar icon, click **Create Chat Record**: the panel asks you to click the toolbar icon. Nothing is copied.
- [ ] Click the toolbar icon once, then **Create Chat Record**: "Chat Record copied to the clipboard as a PNG."
- [ ] Paste into an image editor (e.g. Preview: File > New from Clipboard): it shows exactly the messages on screen, with no Chat list, Chat header, message box, scrollbar, or the extension's panel/button.
- [ ] Repeat with WhatsApp's dark theme: colours match what was on screen.
- [ ] Repeat at a browser zoom other than 100% (Cmd + / Cmd -): the crop still matches the chat area.
- [ ] If WhatsApp changes and the panel says the page wasn't recognised, refresh the selectors and snapshots (see the fixtures README).

## Manual smoke checklist (Date Ranges, [#5](https://github.com/motiko/whatsapp-assistant/issues/5))

- [ ] Open the panel: To shows today, From is empty and **Create Chat Record** is disabled.
- [ ] Neither picker offers a day after today. Typing a future day says "Dates can't be in the future."
- [ ] From after To says "From can't be after To." and keeps Create disabled.
- [ ] **Today**, **Last 7 days** and **Last 30 days** fill From/To with today, today minus 6 and today minus 29.
- [ ] In a Chat with messages over several days, pick a range of 2-4 days that is more than one screen tall
      and well above the newest messages. Create: the Chat scrolls up on its own, then down screen by screen.
- [ ] Paste the PNG: it starts with the From day's date divider (or the first later day with messages) and
      ends right after the last message of the To day (or the last earlier day with messages); nothing from
      outside the range.
- [ ] Scan the stitched PNG at each screen boundary: no message is missing, cut or repeated.
- [ ] No floating WhatsApp UI is baked into the slices (the date chip that appears while scrolling, the
      "scroll to bottom" arrow, hover menus). If it is, note which, so the adapter can hide or wait for it.
- [ ] A range ending today, a single-day range, and a range starting before the Chat's first message.
- [ ] A range with no messages (e.g. a quiet weekend): "No messages between X and Y", nothing copied.
- [ ] A long range (10+ screens): the clipboard write still succeeds after capture finishes (keep the tab focused).
- [ ] Repeat with dark theme, a group Chat, and a WhatsApp Web language/browser locale whose date order differs
      (e.g. en-US): if dividers can't be read the panel says the page wasn't recognised.
