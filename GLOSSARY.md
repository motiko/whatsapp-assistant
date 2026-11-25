# WhatsApp Assistant

A personal Chrome extension that works on top of WhatsApp Web. Its first job is producing screenshots of chats to keep as a record of what was said; its second is translating one Chat both ways through a Telegram bot.

## Language

**Chat**:
A single WhatsApp conversation thread with one contact or one group, as listed in WhatsApp Web's sidebar.
_Avoid_: Conversation, thread

**Date Range**:
A start date and an end date the user gives, which together select every message of one Chat sent between them.
_Avoid_: Message range, selection, excerpt, period

**Full Chat**:
Every message of a Chat, from its oldest message to its newest. The alternative to a Date Range.
_Avoid_: Whole history, entire conversation

**Chat Record**:
A faithful image of the messages in a Date Range or a Full Chat, exactly as WhatsApp Web displayed it, kept as a record of what was said. Small ones are a single image; large ones are a multi-page document.
_Avoid_: Screenshot, Chat History (implies the Full Chat), capture, snapshot

**Context Band**:
The strip added above a Chat Record stating the Chat's name, the date span covered, and when the Chat Record was taken. It never alters the WhatsApp pixels it accompanies.
_Avoid_: Header, watermark, caption

**Partial Chat Record**:
A Chat Record saved from a run that failed partway: everything captured up to the last complete message, marked as partial in its Context Band and file name.
_Avoid_: Incomplete record (incomplete history is a different thing), broken record

**Continuation**:
A run that picks up a failed run's Date Range right after the last message of its Partial Chat Record and runs to the original end. A Continuation can itself end in a Partial Chat Record and be continued again.
_Avoid_: Resume, retry, restart

**Gap Record**:
A separate Chat Record of the messages missed between a Partial Chat Record and its Continuation, made only when the two don't join up.
_Avoid_: Fill, patch

**Translated Chat**:
A Chat the user chose for auto-translation, with the language its contact writes in: its new incoming messages are translated and sent to the Translation Bot, and the user's replies to them are translated into that language and sent to it. There can be several.
_Avoid_: Target chat, watched chat

**Translation Bot**:
The user's own Telegram bot, and the Telegram chat linked to it, through which the user reads the Translated Chat's messages in their language and answers them.
_Avoid_: Telegram chat (ambiguous with a WhatsApp Chat), relay

**Transcriber**:
The speech-to-text service, with the user's own key, that turns voice notes into text before they are translated: a Translated Chat's voice notes for the user, and the user's voice notes to the Translation Bot for the Chat.
_Avoid_: Speech recogniser, STT (in prose)

**Audio Probe**:
The small part of the extension that runs in WhatsApp Web's own page world and hands the Chat Watcher a voice note's audio.
_Avoid_: Hook, injector

**Chat Watcher**:
The part of the extension in WhatsApp Web that notices new messages in the Translated Chats, switching WhatsApp Web to one when its Chat list row shows something new, and types the Translation Bot's replies into them.
_Avoid_: Listener, observer
