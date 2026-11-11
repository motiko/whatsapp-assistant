# WhatsApp Assistant

A personal Chrome extension that runs on [WhatsApp Web](https://web.whatsapp.com) and makes
**Chat Records**: faithful images of a Chat, made of WhatsApp Web's own pixels
(see [GLOSSARY.md](GLOSSARY.md) and [docs/adr/](docs/adr/)).

Current state ([#2](https://github.com/motiko/whatsapp-assistant/issues/2) walking skeleton,
[#5](https://github.com/motiko/whatsapp-assistant/issues/5) Date Ranges,
[#6](https://github.com/motiko/whatsapp-assistant/issues/6) Context Band, file name and Download,
[#8](https://github.com/motiko/whatsapp-assistant/issues/8) large Chat Records as a PDF,
[#4](https://github.com/motiko/whatsapp-assistant/issues/4) progress, Cancel and failure handling,
[#3](https://github.com/motiko/whatsapp-assistant/issues/3) "Read more",
[#7](https://github.com/motiko/whatsapp-assistant/issues/7) Full Chat and incomplete history; together
the whole of [#1](https://github.com/motiko/whatsapp-assistant/issues/1); plus
[#9](https://github.com/motiko/whatsapp-assistant/issues/9) Partial Chat Records, Continue and Gap Records):
a button in the open Chat's header opens a panel where you pick a **Date Range** (From/To pickers
or the Today, Last 7 days, Last 30 days, Year to date and Last 2 years presets) or the **Full Chat**. **Create Chat Record**
scrolls the Chat to the range itself, loading older messages as needed (including clicking WhatsApp
Web's prompt to get them from the phone), expands every "Read more" so long messages show in full,
captures as many screens as needed and copies them, stitched, to the clipboard as one PNG, with a
**Context Band** above it; a **Download** button saves the same PNG. When WhatsApp Web can't load
history as far back as asked, the Chat Record starts at the earliest available day and the Context
Band says so. A Chat Record more than 10 chat-area heights tall downloads as a multi-page PDF
instead. While it runs the panel shows progress and **Cancel**, and WhatsApp Web is locked against
clicks. If a run fails part-way, what was captured is kept as a **Partial Chat Record** and the panel
offers **Continue** to record the rest.

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

### Capture and Chrome's debugging bar

The extension captures WhatsApp Web through Chrome's debugger (`debugger` permission, see
[ADR-0004](docs/adr/0004-capture-with-the-debugger.md)), so a Chat Record keeps going while you use
other tabs or the window is behind others or minimised, and no toolbar click is needed. Chrome warns
about this permission when the extension is installed. While a Chat Record is being made, Chrome
shows a yellow "WhatsApp Assistant started debugging this browser" bar; that is expected. Don't click
its **Cancel**: that stops the capture, and the run ends as a Partial Chat Record (see Use, step 8).
The bar may stay a few seconds after the run. The toolbar icon still opens the panel, as a shortcut.

## Use

1. Open a Chat. A camera button appears in the Chat header, left of WhatsApp's own icons.
2. Click it. The panel names the Chat the Chat Record will be of.
3. Pick **From** and **To** (To starts at today), or click **Today**, **Last 7 days**,
   **Last 30 days**, **Year to date** or **Last 2 years**. Days are whole days in your computer's timezone, both ends included, as
   WhatsApp Web's date dividers show them. From can't be after To, and neither in the future.
   Or click **Full Chat** for every message WhatsApp Web can load (picking a date or another preset
   goes back to a Date Range).
4. Click **Create Chat Record**. You can switch to other tabs or windows meanwhile, but don't scroll
   or click in WhatsApp Web, resize the window, or cancel Chrome's debugging bar until it is done.
   The extension scrolls to the range, captures screen by screen and copies one PNG to the clipboard: from the top of the first day's date
   divider to the bottom of the last message of the last day, cropped to the chat area (no Chat
   list, header, message box, scrollbar or extension UI). A range with no messages says
   "No messages between X and Y" and copies nothing. To reach the range it loads older messages,
   clicking WhatsApp Web's "get older messages from your phone" prompt when it appears; a Full Chat
   loads all of them first, so it can take a while (each load waits up to 5 seconds).
   If WhatsApp Web runs out of older messages before the From day, the Chat Record starts at the
   earliest day available and the Context Band says so: `Requested from <From>; earliest available
   <day>`. A Full Chat's Context Band always ends `Full Chat; earliest available <day>`.

   While it runs, the panel shows how many screens it has captured and the day it has reached,
   says you can switch tabs, and offers **Cancel** (which stops it and copies nothing).
   WhatsApp Web is dimmed and locked against clicks and scrolling until it ends, and the panel
   can't be closed. The lock, panel and button are made invisible for each capture, so they are
   never in the Chat Record. Only one Chat Record runs at a time. The run fails if Chrome's debugging
   bar is cancelled, the chat area moves or changes size (the window is resized), WhatsApp Web's
   page stops looking as expected ("page wasn't recognised") or stops scrolling as expected.
   Reloading or closing WhatsApp Web ends the run with nothing saved (the page and the run in it
   are gone). What was captured until then is kept
   as a Partial Chat Record (see step 8); if not even one whole message was captured, nothing is
   copied. **Cancel** always produces nothing.
5. Above the messages, in a separate white strip (the Context Band), are the Chat's name, the days
   the Chat Record actually covers (the first and last day with messages in the range, which can be
   narrower than the range you picked) and when it was taken (local time and UTC offset).
6. Click **Download PNG** to also save it as `Chat history - <Chat name> - <from> to <to>.png`
   (a single day reads just `<date>`), named from the days actually covered. The panel confirms
   where the Chat Record went.
7. A Chat Record more than 10 times as tall as the chat area (about ten screens) is not copied: it
   downloads straight away as `Chat history - <Chat name> - <from> to <to>.pdf`, and the panel names
   the file. Each page is about one chat area tall and shows the Chat at its on-screen size. Pages
   end between messages (at the top of a message or date divider), so no message is split; only a
   single message taller than a whole page is split, at the page's height. The Context Band is at
   the top of the first page only. Page images are lossless (the same pixels as a PNG), made on
   your computer with [pdf-lib](https://github.com/Hopding/pdf-lib); nothing is uploaded.
8. **A run that fails part-way** (not one you cancel) keeps everything up to the last message it
   captured in full as a **Partial Chat Record**: copied as a PNG with **Download PNG**, or downloaded
   as a PDF when long, like any Chat Record. Its file name ends ` (partial)`, e.g.
   `Chat history - Joy - 2026-01-01 to 2026-03-14 (partial).pdf`, where the end date is the last day
   actually captured, and its Context Band adds `Partial: stopped after <day> <time>, run failed:
   <reason>` (the time is the one WhatsApp shows on that message; just the day if it shows none).
   The panel then offers **Continue from <day> <time>** whenever it is opened on that Chat, also after
   reloading WhatsApp Web. Continue records from right after that message (found again by WhatsApp's
   message id) to the original To day, or to the newest message for a Full Chat; its Context Band says
   which partial record it continues. If that message can't be found again, it starts at the
   beginning of its day instead, overlapping the partial record rather than leaving a gap. A
   Continuation that fails too saves another Partial Chat Record and offers Continue again; one that
   finishes is forgotten.
9. When a Continuation finishes it checks that its first message is the one right after the partial
   record's last. If messages were missed in between, it records just those and downloads them as a
   separate **Gap Record**, `Chat history - <Chat name> - <days> (gap).png` (or `.pdf`), whose Context
   Band names the two records it connects. Overlap (repeated messages) is left alone. The panel says
   when this happens, and warns if the missed messages couldn't be recorded.

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
  builder (`src/core/file-name.test.ts`) is also tested directly. PDF Chat Records are read back page
  by page with `src/core/testing/read-pdf.ts`; those tests use a small screen (a 100px chat area) so
  records taller than ten chat areas stay within the 4095 device pixels the fake Camera can encode.
  Partial Chat Records, Continuations and Gap Records are tested the same way: a run fails part-way
  (fake Camera or page failures), a fresh fake page plays a reloaded WhatsApp Web, and the stitched
  rows of the records together must cover every Chat row exactly once.
- **Pending Continuations** (`src/extension/continuation-store.test.ts`): what is kept per Chat, and
  that only ids, days, times, the request and the failure reason are written, through an in-memory
  stand-in for `chrome.storage.session`.
- **Date Range fields** (`src/ui/date-range-fields.test.ts`): pickers, presets and validation,
  driven through the DOM with a fixed "today".
- **Panel while recording** (`src/ui/record-panel.test.ts`): progress text, Cancel, the notice, the
  lock over WhatsApp Web, and that `hide()` makes all of it invisible for captures; Continue offered
  only for the open Chat's pending Continuation, and the confirmations for partial and gap saves;
  driven through the DOM with a scripted `createChatRecord` and an in-memory Continuation store.
- **Camera per run** (in `src/core/chat-recorder.test.ts`): the Camera is started once before WhatsApp
  Web is touched and stopped once however the run ends; a Camera that can't start fails the run, and a
  chat area that moves or changes size part-way ends it as a Partial Chat Record. The real Camera
  (`src/extension/debugger-camera.ts`, `capture-sessions.ts`) talks to `chrome.debugger` and has no
  automated tests; it is covered by the background-capture smoke checklist below.
- **WhatsApp Web adapter** (`src/whatsapp-web/*.test.ts`): run against page snapshots in
  `src/whatsapp-web/fixtures/`, rendered in a real 1280x800 frame (also one that runs no animation frames, as in a background
  tab). **These snapshots are currently
  synthetic** (hand-written to resemble WhatsApp Web); see
  [the fixtures README](src/whatsapp-web/fixtures/README.md) for how to replace them with real,
  scrubbed ones.

## Code layout

| Path | Module |
| --- | --- |
| `src/core/chat-recorder.ts` | **Chat Recorder**: request (a Date Range, the Full Chat, a Continuation of a Partial Chat Record, or the visible chat area) plus optional `onProgress` and cancel `signal` in, outcome out (a Chat Record, with a Gap Record for a Continuation that missed messages; a Partial Chat Record with its continuation point; *no messages*, *empty chat*, *cancelled*, or *failed* with a reason, including *busy* while another runs). Range resolution (loading older messages, incomplete history), the scroll-and-capture loop with "Read more" expansion, cropping, stitching, adding the Context Band, and choosing PNG or PDF (with PDF page breaks). No Chrome or WhatsApp knowledge. |
| `src/core/context-band.ts` | **Context Band**: its text (with optional extra lines) and drawing it above an image, or on its own |
| `src/core/pdf.ts` | A PDF of page images (lossless, one image per page at its on-screen size), made locally with pdf-lib |
| `src/core/file-name.ts` | The file name a Chat Record is saved under, safe for every OS and Chrome's downloads |
| `src/core/day-span.ts` | Local days (ISO `YYYY-MM-DD`) and the span of days a Chat Record covers |
| `src/core/whatsapp-page.ts` | **WhatsApp Page** interface (Chat name, chat area, scroll position/height, scrolling, loaded date dividers and messages, expanding "Read more" within a span, loading older messages or saying there are none) and `PageNotRecognisedError` |
| `src/core/camera.ts` | **Camera** interface (start/stop once per Chat Record; viewport bitmap + device pixel ratio) and `CaptureNotAllowedError` |
| `src/whatsapp-web/` | **WhatsApp Web adapter**: the only code that knows WhatsApp Web's page. All selectors are in `selectors.ts`; reading divider labels ("Today", weekdays, locale dates) is in `divider-dates.ts`. |
| `src/extension/` | Chrome-side pieces: the debugger Camera (`debugger-camera.ts`, hides own UI) and the background worker's capture sessions (`capture-sessions.ts`: attach, focus emulation, `Page.captureScreenshot`, detach), clipboard and download output, messages to the background worker, pending Continuations in session storage (`continuation-store.ts`) |
| `src/ui/record-panel.ts` | Header button and panel, including progress, Cancel and the lock over WhatsApp Web while recording |
| `src/ui/date-range-fields.ts` | The panel's From/To pickers, presets (including Full Chat) and validation |
| `src/entrypoints/` | WXT entry points: content script (wiring) and background worker (capture sessions, toolbar icon) |

## Permissions and privacy

- `host_permissions`: `https://web.whatsapp.com/*` only.
- `debugger`: captures the WhatsApp Web tab with `Page.captureScreenshot`, also in the background, and
  keeps it rendering meanwhile (see above and [ADR-0004](docs/adr/0004-capture-with-the-debugger.md)).
  It is attached only to the WhatsApp Web tab that started a Chat Record, only while it runs. Chrome
  warns that it gives access to the page debugger backend and all websites' data.
- `clipboardWrite`: lets the content script put the PNG on the clipboard.
- `storage`: `chrome.storage.session`, for pending Continuations (below). The background worker
  lets the content script use it (`setAccessLevel`).
- No `downloads` permission: **Download** clicks a download link from the content script, which needs
  none. The cost is that the extension can't see where Chrome saved the file, so the confirmation
  names the file and your Downloads folder (if Chrome is set to ask where to save, it is wherever you
  chose).

The extension makes no network requests and stores no message content or images; Chat Records exist
only on your clipboard and in files you download. The panel keeps the last Chat Record in memory only
while it offers to download it. The one thing it keeps is where each Partial Chat Record stopped, so
it can offer **Continue**: per Chat, the Chat's name, the request (From and To days, or Full Chat),
WhatsApp's id of the last message captured with its day and time, the failure reason and the partial
record's file name. These are ids and dates only, never message text or pixels, kept in
`chrome.storage.session`: in memory, cleared when Chrome closes (they survive reloading WhatsApp
Web). A Continuation that finishes removes its Chat's entry.

## Manual smoke checklist (walking skeleton)

Needs a logged-in WhatsApp Web, so it is not automated. Use a fresh `npm run build`, loaded unpacked.

- [ ] Open https://web.whatsapp.com and a one-to-one Chat: the camera button appears in the Chat header.
- [ ] Open a group Chat: the button appears there too.
- [ ] Switch between a few Chats (without reloading): the button is in each Chat's header, exactly once.
- [ ] Click the button: the panel opens next to it and names the open Chat. Escape or clicking outside closes it.
- [ ] Without clicking the toolbar icon, click **Create Chat Record**: Chrome's debugging bar appears and "Chat Record copied to the clipboard as a PNG."
- [ ] Paste into an image editor (e.g. Preview: File > New from Clipboard): it shows exactly the messages on screen, with no Chat list, Chat header, message box, scrollbar, or the extension's panel/button.
- [ ] Repeat with WhatsApp's dark theme: colours match what was on screen.
- [ ] Repeat at a browser zoom other than 100% (Cmd + / Cmd -): the crop still matches the chat area.
- [ ] If WhatsApp changes and the panel says the page wasn't recognised, refresh the selectors and snapshots (see the fixtures README).

## Manual smoke checklist (Date Ranges, [#5](https://github.com/motiko/whatsapp-assistant/issues/5))

- [ ] Open the panel: To shows today, From is empty and **Create Chat Record** is disabled.
- [ ] Neither picker offers a day after today. Typing a future day says "Dates can't be in the future."
- [ ] From after To says "From can't be after To." and keeps Create disabled.
- [ ] **Today**, **Last 7 days** and **Last 30 days** fill From/To with today, today minus 6 and today minus 29; **Year to date** with 1 January to today; **Last 2 years** with the day after the same date two years ago to today.
- [ ] In a Chat with messages over several days, pick a range of 2-4 days that is more than one screen tall
      and well above the newest messages. Create: the Chat scrolls up on its own, then down screen by screen.
- [ ] Paste the PNG: below the Context Band it starts with the From day's date divider (or the first later
      day with messages) and ends right after the last message of the To day (or the last earlier day with
      messages); nothing from outside the range.
- [ ] Scan the stitched PNG at each screen boundary: no message is missing, cut or repeated.
- [ ] No floating WhatsApp UI is baked into the slices (the date chip that appears while scrolling, the
      "scroll to bottom" arrow, hover menus). If it is, note which, so the adapter can hide or wait for it.
- [ ] A range ending today, a single-day range, and a range starting before the Chat's first message.
- [ ] A range with no messages (e.g. a quiet weekend): "No messages between X and Y", nothing copied, no
      **Download PNG**.
- [ ] A long range (10+ screens): the clipboard write still succeeds after capture finishes, also when you were in another tab meanwhile.
- [ ] Repeat with dark theme, a group Chat, and a WhatsApp Web language/browser locale whose date order differs
      (e.g. en-US): if dividers can't be read the panel says the page wasn't recognised.

## Manual smoke checklist (Context Band, file name and Download, [#6](https://github.com/motiko/whatsapp-assistant/issues/6))

- [ ] Create a Chat Record and paste it: a white strip above the messages reads `Chat: <name>`, `Messages: <from> to <to>` (the first and last day with messages in the record; a single date for one day) and `Taken: <date> <time> (UTC±hh:mm)` with your local time. The strip doesn't cover any message; the first row under it is the top of the first day's date divider.
- [ ] Pick a range that starts or ends on days without messages: `Messages:` and the file name show the days actually captured, not the ones picked.
- [ ] Repeat in dark theme: the band stays white with dark text; the messages below keep the dark theme.
- [ ] Repeat at a browser zoom other than 100%: the band's text is a sensible size and sharp.
- [ ] In a Chat with a long name (or a group with a long subject), the name wraps onto more band lines rather than being cut off.
- [ ] After creating, the panel says the Chat Record was copied and shows **Download PNG**. Click it: the file appears in your Downloads folder as `Chat history - <name> - <from> to <to>.png`, and the panel says it was downloaded under that name.
- [ ] Download in a Chat whose name has `/`, `:` or emoji (including a joined one such as 👨‍👩‍👧 or a flag): the file saves; `/` and `:` show as `_`, emoji are kept (a joined emoji appears as its parts, e.g. 👨👩👧).
- [ ] Close and reopen the panel: **Download PNG** is gone until a new Chat Record is made.

## Manual smoke checklist (large Chat Records as a PDF, [#8](https://github.com/motiko/whatsapp-assistant/issues/8))

- [ ] Pick a range a little under ten screens of messages: it is still copied as a PNG, with **Download PNG**.
- [ ] Pick a long range in a busy Chat (well over ten screens; a few weeks or months): after capture, the
      panel says it was downloaded as a PDF and names `Chat history - <name> - <from> to <to>.pdf`. Nothing
      new is on the clipboard and no **Download PNG** is offered. The file is in your Downloads folder
      (Chrome may ask once whether the page may download files; allow it).
- [ ] Open the PDF (Preview and Chrome's viewer): page 1 starts with the Context Band, then the first day's
      date divider; the last page ends right after the last message of the range.
- [ ] Page through it: every page is about one screen of messages, and each page break falls between two
      messages (no bubble cut in half, nothing missing or repeated across a break). A message taller than the
      screen (a very long text) is the only thing that may continue onto the next page.
- [ ] Zoom in: the pixels are as sharp as the PNG (no JPEG blur); at 100% the Chat looks its on-screen size.
- [ ] Repeat with dark theme and at a browser zoom other than 100% (e.g. on a Retina screen and an external
      1x monitor): page breaks still fall between messages and the Context Band text is a sensible size.
- [ ] A very long record (hundreds of screens): note how long it takes and whether the tab runs out of
      memory (all screens are kept in memory until the PDF is made).
- [ ] DevTools' Network panel shows no requests from the extension while the PDF is made.

## Manual smoke checklist (progress, Cancel and failures, [#4](https://github.com/motiko/whatsapp-assistant/issues/4))

- [ ] Start a long Date Range (10+ screens): the panel shows "N screens captured, up to <day>…", counting up
      with the day moving forward; a yellow notice says you can switch tabs; a **Cancel** button shows; the
      close button is disabled and Escape or clicking outside doesn't close the panel.
- [ ] While it runs, WhatsApp Web is dimmed; clicking a message, another Chat in the Chat list, or scrolling
      the chat with the mouse wheel or trackpad does nothing.
- [ ] Paste the result: no dimming, panel, progress text, notice or button anywhere in the image.
- [ ] Click **Cancel** part-way (also on a range long enough for a PDF: no PDF is downloaded): within about a second the Chat stops scrolling, the panel says
      "Cancelled. No Chat Record was made.", the clipboard still holds what it held before, WhatsApp Web is
      no longer dimmed and can be scrolled and clicked, and **Create Chat Record** works again.
- [ ] Start a long run and click **Cancel** on Chrome's debugging bar part-way: the panel says the run failed
      part-way because capturing was stopped from that bar, and keeps what was captured as a Partial Chat Record
      (see the [#9](https://github.com/motiko/whatsapp-assistant/issues/9) checklist).
- [ ] Start a long run and resize the window part-way: the run fails ("the chat area moved or changed size")
      and keeps what was captured as a Partial Chat Record.
- [ ] While one runs, click the toolbar icon (reopens the panel): it keeps showing progress and doesn't let you
      start a second Chat Record.
- [ ] Reload WhatsApp Web part-way: the run stops (the page and the run in it are gone, so no Partial Chat
      Record can be saved), the debugging bar goes away, and after the reload the button and panel work again.

## Manual smoke checklist ("Read more", [#3](https://github.com/motiko/whatsapp-assistant/issues/3))

The "Read more" selector (`.read-more-button` in `src/whatsapp-web/selectors.ts`) and the snapshot it is
tested against are synthetic, so these checks are the first proof it works on the real page.

- [ ] In a Chat, send or find a message long enough that WhatsApp Web cuts it short with "Read more". Leave it
      cut short, then record a Date Range containing it: in the PNG the message shows its whole text, with no
      "Read more", and the stitched image has no gap, cut or repeated rows around it or below it.
- [ ] The same with the long message straddling a screen boundary (scroll so it sits at the bottom of the chat
      area before recording a range that starts a screen or so above it) and as the very last message of the
      range: the Chat Record ends right after its full text.
- [ ] A very long message (several thousand characters) that WhatsApp may expand in steps: the whole text is in
      the Chat Record.
- [ ] Long messages outside the range are left as they were (cut short) if they never came on screen; ones that
      did may be expanded, which is harmless.
- [ ] A long message with a link, a quoted reply, and one in a group Chat: all expanded.
- [ ] If the panel says the page wasn't recognised right after expanding, note what "Read more" looks like in
      DevTools (element, class, role) so the selector and the snapshot can be fixed.

## Manual smoke checklist (Full Chat and incomplete history, [#7](https://github.com/motiko/whatsapp-assistant/issues/7))

- [ ] Click **Full Chat**: it is highlighted, From empties and a note says every message WhatsApp Web can load will be
      recorded; Create is enabled. Picking a From date or another preset turns it off again.
- [ ] Full Chat on a short Chat (a few screens): the Chat scrolls to the very top on its own, then down. The PNG starts
      with the oldest day's date divider and ends with the newest message; the Context Band's `Messages:` starts at that
      oldest day and its last line reads `Full Chat; earliest available <that day>`. The file name uses the same days.
- [ ] In a Chat whose older history WhatsApp Web only has on the phone, scroll to the top by hand first and note the
      prompt's exact wording ("Click here to get older messages from your phone." or other). Then make a Full Chat or a
      Date Range reaching before it: the extension clicks the prompt itself and the record includes the older messages.
      If it doesn't click it, save a scrubbed snapshot of that row for the adapter (see the fixtures README).
- [ ] With the phone offline (or history not available), the same record still completes from the earliest day
      WhatsApp Web shows, after a short wait, instead of hanging.
- [ ] Pick a Date Range starting well before the Chat's first message (e.g. From 2015-01-01): the record starts at the
      first available day and the Context Band's last line reads `Requested from 2015-01-01; earliest available <day>`;
      the file name uses `<day> to <to>`.
- [ ] A Date Range whose From day is loadable gets no such line.
- [ ] A Date Range entirely before the earliest available day still says "No messages between X and Y".
- [ ] A Full Chat in a Chat without messages says the Chat has no messages and copies nothing.
- [ ] A Full Chat of a long Chat shows progress, downloads as a PDF when over ten screens, and expands "Read more"
      on the way down; clicking **Cancel** while it is still loading older history (before any screen is captured)
      stops it within a few seconds with "Cancelled. No Chat Record was made."

## Manual smoke checklist (Partial Chat Records, Continue and Gap Records, [#9](https://github.com/motiko/whatsapp-assistant/issues/9))

The message time comes from WhatsApp Web's `data-pre-plain-text` on text messages (`messageTimestamp` in
`src/whatsapp-web/selectors.ts`), which is unverified against the real page; without it the panel and Context
Band show only the day.

- [ ] Start a Date Range of 4+ screens and click **Cancel** on Chrome's debugging bar after two or three screens: the panel
      says the run failed part-way, that what was captured up to <day> <time> was copied as a partial Chat Record,
      and to click **Continue from <day> <time>**. **Download PNG** saves `Chat history - <name> - <from> to <day
      reached> (partial).png`.
- [ ] Paste it: it ends right after a whole message (no message cut off at the bottom); the Context Band's last
      line reads `Partial: stopped after <day> <time>, run failed: <reason>`, and the time matches that message's
      time in WhatsApp.
- [ ] The same with a range long enough for a PDF (fail it after 11+ screens): a ` (partial).pdf` downloads at once.
- [ ] **Cancel** part-way instead: nothing is copied and no Continue appears.
- [ ] Close and reopen the panel, then open another Chat and the panel: Continue shows only in the first Chat.
- [ ] Reload WhatsApp Web, open the same Chat and the panel: Continue is still there.
      Click it, then **Create Chat Record**: the Chat scrolls to the partial record's last message (loading older
      messages if needed) and records from right below it to the original To day. Paste both images one above the
      other: together they show every message exactly once, no gap, no repeat. Its Context Band says which partial
      record it continues. Continue is gone afterwards.
- [ ] Continue a partial Full Chat: the Continuation ends with the newest message.
- [ ] Chain: fail a Continuation part-way too: a second ` (partial)` record and a new Continue from its last message;
      continuing again completes the range, and the three images together have every message once.
- [ ] Picking a preset or a date after clicking Continue goes back to a normal Date Range.
- [ ] Quit and restart Chrome: no Continue is offered (session storage is cleared).
- [ ] DevTools > Application > Storage > Session storage for the extension (or `chrome.storage.session.get()` in the
      background worker's console): the entry holds only the Chat's name, the request days, the message id, day and
      time, the reason and the partial file name; no message text or image.
- [ ] A Gap Record can't be provoked on purpose (a Continuation that finds the message starts exactly below it).
      If a Continuation ever downloads a ` (gap)` file, check that it holds exactly the messages missing between the
      two records and that its Context Band names both files.

## Manual smoke checklist (capture in the background, [ADR-0004](docs/adr/0004-capture-with-the-debugger.md))

- [ ] Reload the extension after updating: Chrome lists the new `debugger` permission (an installed, packed
      build asks for it with a warning); WhatsApp Web works without clicking the toolbar icon.
- [ ] Start a Date Range of 10+ screens and switch to another tab in the same window right away. Come back
      when it is done: the record is complete, with no message missing, cut or repeated at screen joins, no
      white message-box strips and no extension UI; the PNG was copied to the clipboard (or the PDF downloaded).
- [ ] The same with the WhatsApp window behind another window, and with it minimised.
- [ ] It takes about as long as with the tab in front (it is not slowed to one step a second).
- [ ] While it runs, Chrome shows "WhatsApp Assistant started debugging this browser"; it goes away after the
      run (it may take a few seconds). Starting another run right after one still records correctly.
- [ ] Close the WhatsApp tab part-way: the debugging bar goes away; reopening WhatsApp Web works normally.
- [ ] With DevTools open on the WhatsApp tab, a Chat Record still works (or fails with "Chrome didn't let this
      extension capture this tab" and the reason).
- [ ] A long PDF record finished while you are in another tab still downloads.
- [ ] Screen joins show no thin line across the image (a 1px line at the joins was seen with the synthetic
      fixture in Chromium; check whether real WhatsApp Web does it too).
