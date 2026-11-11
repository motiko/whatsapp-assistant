# WhatsApp Assistant

A personal Chrome extension that runs on [WhatsApp Web](https://web.whatsapp.com) and makes
**Chat Records**: faithful images of a Chat, made of WhatsApp Web's own pixels
(see [GLOSSARY.md](GLOSSARY.md) and [docs/adr/](docs/adr/)).

Current state (walking skeleton, [#2](https://github.com/motiko/whatsapp-assistant/issues/2)):
a button in the open Chat's header opens a panel whose **Create Chat Record** button copies the
chat area currently on screen to the clipboard as a PNG, with a **Context Band** above it
([#6](https://github.com/motiko/whatsapp-assistant/issues/6)) and a **Download** button. Date Ranges,
Full Chat and PDF output come in later tickets of [#1](https://github.com/motiko/whatsapp-assistant/issues/1).

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
3. Click **Create Chat Record**. The chat area on screen (no Chat list, no header, no message box,
   no scrollbar, none of the extension's own UI) is copied to the clipboard as a PNG. Above it, in a
   separate white strip (the Context Band), are the Chat's name, the day covered and when the Chat
   Record was taken (local time and UTC offset). Until Date Ranges land, the day covered is the day
   the record was taken, whatever dates the messages on screen have.
4. Click **Download PNG** to also save it as `Chat history - <Chat name> - <date>.png` (a range
   reads `<from> to <to>`). The panel confirms where the Chat Record went.

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
  tests can check exactly which part of the screen ends up where in a Chat Record (for example, that
  the Context Band sits above the WhatsApp pixels and leaves every one of them unchanged). The
  recorder takes an injected clock, and the test browser runs in the `Europe/Berlin` timezone
  (`vitest.config.ts`), so days and "taken at" times are the same on every machine. The file-name
  builder (`src/core/file-name.test.ts`) is also tested directly, for spans a record of the visible
  chat can't produce yet.
- **WhatsApp Web adapter** (`src/whatsapp-web/*.test.ts`): run against page snapshots in
  `src/whatsapp-web/fixtures/`, rendered in a real 1280x800 frame. **These snapshots are currently
  synthetic** (hand-written to resemble WhatsApp Web); see
  [the fixtures README](src/whatsapp-web/fixtures/README.md) for how to replace them with real,
  scrubbed ones.

## Code layout

| Path | Module |
| --- | --- |
| `src/core/chat-recorder.ts` | **Chat Recorder**: request in, outcome out (a Chat Record, or *failed* with a reason). No Chrome or WhatsApp knowledge. |
| `src/core/context-band.ts` | **Context Band**: its text (with optional extra lines) and drawing it above an image, or on its own |
| `src/core/file-name.ts` | The file name a Chat Record is saved under, safe for every OS and Chrome's downloads |
| `src/core/day-span.ts` | Days covered by a Chat Record, as ISO local dates |
| `src/core/whatsapp-page.ts` | **WhatsApp Page** interface (Chat name, chat area) and `PageNotRecognisedError` |
| `src/core/camera.ts` | **Camera** interface (visible-tab bitmap + device pixel ratio) and `CaptureNotAllowedError` |
| `src/whatsapp-web/` | **WhatsApp Web adapter**: the only code that knows WhatsApp Web's page. All selectors are in `selectors.ts`. |
| `src/extension/` | Chrome-side pieces: the tab Camera, clipboard and download output, messages to the background worker |
| `src/ui/record-panel.ts` | Header button and panel |
| `src/entrypoints/` | WXT entry points: content script (wiring) and background worker (tab capture) |

## Permissions and privacy

- `host_permissions`: `https://web.whatsapp.com/*` only.
- `activeTab`: needed for `chrome.tabs.captureVisibleTab` (see above).
- `clipboardWrite`: lets the content script put the PNG on the clipboard.
- No `downloads` permission: **Download** clicks a download link from the content script, which needs
  none. The cost is that the extension can't see where Chrome saved the file, so the confirmation
  names the file and your Downloads folder (if Chrome is set to ask where to save, it is wherever you
  chose).

The extension makes no network requests and stores nothing; Chat Records exist only on your clipboard
and in files you download. The panel keeps the last Chat Record in memory only while it offers to
download it.

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

## Manual smoke checklist (Context Band, file name and Download, [#6](https://github.com/motiko/whatsapp-assistant/issues/6))

- [ ] Create a Chat Record and paste it: a white strip above the messages reads `Chat: <name>`, `Messages: <today>` and `Taken: <date> <time> (UTC±hh:mm)` with your local time. The strip doesn't cover any message; the first row under it is the top of the chat area.
- [ ] Repeat in dark theme: the band stays white with dark text; the messages below keep the dark theme.
- [ ] Repeat at a browser zoom other than 100%: the band's text is a sensible size and sharp.
- [ ] In a Chat with a long name (or a group with a long subject), the name wraps onto more band lines rather than being cut off.
- [ ] After creating, the panel says the Chat Record was copied and shows **Download PNG**. Click it: the file appears in your Downloads folder as `Chat history - <name> - <today>.png`, and the panel says it was downloaded under that name.
- [ ] Download in a Chat whose name has `/`, `:` or emoji (including a joined one such as 👨‍👩‍👧 or a flag): the file saves; `/` and `:` show as `_`, emoji are kept (a joined emoji appears as its parts, e.g. 👨👩👧).
- [ ] Close and reopen the panel: **Download PNG** is gone until a new Chat Record is made.
