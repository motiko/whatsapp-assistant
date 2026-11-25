import { beforeEach, describe, expect, test } from 'vitest';
import type { LoadedMessage } from './new-messages';
import { createMemoryArea, createTranslationStore, defaultSettings, type TranslationSettings } from './store';
import type { Telegram, TelegramUpdate } from './telegram';
import { createTranslationBot, maxPairingFails, type SendOutcome } from './translation-bot';
import type { Transcriber } from './transcriber';
import type { Translator } from './translator';

const ownChat = '1001';
const strangerChat = '2002';

/** A Telegram that keeps what the bot sent and how messages ended up. */
function fakeTelegram() {
  const messages = new Map<number, { chatId: string; html: string; replyTo?: number }>();
  let nextId = 500;
  let failSends = false;
  const voices: { chatId: string; size: number; replyTo?: number }[] = [];
  const files = new Map<string, Blob>();
  const telegram: Telegram = {
    async sendMessage(chatId, html, options = {}) {
      if (failSends) throw new Error('Telegram is down');
      const id = nextId++;
      messages.set(id, { chatId, html, ...(options.replyTo ? { replyTo: options.replyTo } : {}) });
      return id;
    },
    async editMessage(chatId, messageId, html) {
      messages.set(messageId, { ...messages.get(messageId)!, chatId, html });
    },
    async getUpdates() {
      return [];
    },
    async username() {
      return 'test_bot';
    },
    async sendVoice(chatId, audio, options = {}) {
      const id = nextId++;
      voices.push({ chatId, size: audio.size, ...(options.replyTo ? { replyTo: options.replyTo } : {}) });
      return id;
    },
    async downloadFile(fileId) {
      const file = files.get(fileId);
      if (!file) throw new Error(`no file ${fileId}`);
      return file;
    },
  };
  return {
    telegram,
    /** The final text of every message sent, in order. */
    texts: () => Array.from(messages.values(), (message) => message.html),
    to: (chatId: string) => Array.from(messages.values()).filter((message) => message.chatId === chatId).map((m) => m.html),
    /** The id of the last message whose text contains `part`. */
    idOf: (part: string) => Array.from(messages.entries()).filter(([, message]) => message.html.includes(part)).at(-1)![0],
    failSends(fail: boolean) {
      failSends = fail;
    },
    /** Voice notes the bot sent. */
    voices,
    /** Files users sent, by file id. */
    files,
  };
}

/** Hears whatever text the audio holds; can fail, or hear nothing. */
function fakeTranscriber(options: { fail?: boolean } = {}) {
  const calls: { size: number; language?: string }[] = [];
  const transcriber: Transcriber = {
    async transcribe(audio, { language } = {}) {
      calls.push({ size: audio.size, ...(language ? { language } : {}) });
      if (options.fail) throw new Error('STT down');
      return { text: (await audio.text()).trim() };
    },
  };
  return { transcriber, calls };
}

/** Translates by tagging the text with the target language: "hallo" → "[en] hallo". */
function fakeTranslator(options: { detected?: string; fail?: boolean } = {}) {
  const calls: { text: string; from: string; to: string }[] = [];
  const translator: Translator = {
    async translate(text, from, to) {
      calls.push({ text, from, to });
      if (options.fail) throw new Error('translator down');
      return { text: `[${to}] ${text}`, ...(options.detected ? { detected: options.detected } : {}) };
    },
  };
  return { translator, calls };
}

function fakeWhatsApp(outcome: SendOutcome = { kind: 'sent' }) {
  const sent: { chatName: string; text: string }[] = [];
  return {
    sent,
    link: {
      async send(chatName: string, text: string) {
        sent.push({ chatName, text });
        return outcome;
      },
    },
  };
}

const configured: Partial<TranslationSettings> = {
  enabled: true,
  myLanguage: 'en',
  chats: [{ name: 'Anna', contactLanguage: 'de' }],
  telegramToken: 'token',
  telegramChatId: ownChat,
};

function setup(
  options: {
    settings?: Partial<TranslationSettings>;
    translator?: ReturnType<typeof fakeTranslator>;
    whatsapp?: ReturnType<typeof fakeWhatsApp>;
    transcriber?: ReturnType<typeof fakeTranscriber>;
    now?: number;
  } = {},
) {
  const area = createMemoryArea({ 'translation.settings': { ...defaultSettings, ...configured, ...options.settings } });
  const store = createTranslationStore(area);
  const tg = fakeTelegram();
  const translator = options.translator ?? fakeTranslator();
  const whatsapp = options.whatsapp ?? fakeWhatsApp();
  const errors: unknown[] = [];
  const bot = createTranslationBot({
    store,
    telegram: () => tg.telegram,
    translator: () => translator.translator,
    transcriber: () => options.transcriber?.transcriber,
    whatsapp: whatsapp.link,
    now: () => options.now ?? 1_000_000_000_000,
    newCode: () => '123456',
    logError: (error) => errors.push(error),
  });
  return { bot, store, tg, translator, whatsapp, errors };
}

let updateId = 1;
/** A message already in a Chat when it is first seen: history, never forwarded. */
const history: LoadedMessage[] = [{ id: 'history', direction: 'in', text: 'Old message' }];
function textFrom(chatId: string, text: string, date?: number, replyTo?: number): TelegramUpdate {
  return {
    update_id: updateId++,
    message: {
      message_id: updateId,
      chat: { id: Number(chatId) },
      text,
      ...(date ? { date } : {}),
      ...(replyTo ? { reply_to_message: { message_id: replyTo, chat: { id: Number(chatId) } } } : {}),
    },
  };
}

beforeEach(() => {
  updateId = 1;
});

describe('linking a Telegram chat', () => {
  test('a chat that sends the pairing code is linked, and told so', async () => {
    const { bot, store, tg } = setup({ settings: { telegramChatId: '' } });
    await bot.startPairing();

    await bot.handleUpdate(textFrom(strangerChat, '123456'));

    expect((await store.settings()).telegramChatId).toBe(strangerChat);
    expect(await store.pairing()).toBeUndefined();
    expect(tg.to(strangerChat)[0]).toContain('Linked');
  });

  test('"/start <code>" from the bot’s deep link links too', async () => {
    const { bot, store } = setup({ settings: { telegramChatId: '' } });
    await bot.startPairing();

    await bot.handleUpdate(textFrom(strangerChat, '/start 123456'));

    expect((await store.settings()).telegramChatId).toBe(strangerChat);
  });

  test('a bare "/start" (pressing Start without the bot’s link) links nobody, and counts as a wrong try', async () => {
    const { bot, store } = setup({ settings: { telegramChatId: '' } });
    await bot.startPairing();

    await bot.handleUpdate(textFrom(strangerChat, '/start'));

    expect((await store.settings()).telegramChatId).toBe('');
    expect((await store.pairing())?.fails).toBe(1);
  });

  test('without a pending code, nobody is linked and nothing is answered', async () => {
    const { bot, store, tg } = setup({ settings: { telegramChatId: '' } });

    await bot.handleUpdate(textFrom(strangerChat, '123456'));

    expect((await store.settings()).telegramChatId).toBe('');
    expect(tg.texts()).toEqual([]);
  });

  test('an expired code links nobody', async () => {
    const { bot, store } = setup({ settings: { telegramChatId: '' }, now: 11 * 60_000 });
    await store.setPairing({ code: '123456', until: 10 * 60_000, fails: 0 });

    await bot.handleUpdate(textFrom(strangerChat, '123456'));

    expect((await store.settings()).telegramChatId).toBe('');
  });

  test(`${maxPairingFails} wrong messages void the code, so guessing it doesn’t work`, async () => {
    const { bot, store } = setup({ settings: { telegramChatId: '' } });
    await bot.startPairing();

    for (let n = 0; n < maxPairingFails; n++) await bot.handleUpdate(textFrom(strangerChat, `00000${n}`));
    await bot.handleUpdate(textFrom(strangerChat, '123456'));

    expect((await store.settings()).telegramChatId).toBe('');
  });

  test('a stranger writing to a linked bot is ignored', async () => {
    const { bot, tg, whatsapp } = setup();

    await bot.handleUpdate(textFrom(strangerChat, 'send this to Anna'));

    expect(whatsapp.sent).toEqual([]);
    expect(tg.texts()).toEqual([]);
  });
});

describe('replies from Telegram', () => {
  test('are translated into the contact’s language and sent to the Translated Chat', async () => {
    const translator = fakeTranslator();
    const { bot, whatsapp, tg } = setup({ translator });

    await bot.handleUpdate(textFrom(ownChat, 'See you tomorrow'));

    expect(whatsapp.sent).toEqual([{ chatName: 'Anna', text: '[de] See you tomorrow' }]);
    expect(translator.calls[0]).toEqual({ text: 'See you tomorrow', from: 'en', to: 'de' });
    // Then confirmed, with a back-translation of what was sent.
    expect(translator.calls[1]).toEqual({ text: '[de] See you tomorrow', from: 'de', to: 'en' });
    expect(tg.to(ownChat)).toEqual([
      '✅ Sent to <b>Anna</b>:\n[de] See you tomorrow\n\n↩️ <i>[en] [de] See you tomorrow</i>',
    ]);
  });

  test('a send that failed says so, with the reason', async () => {
    const { bot, tg } = setup({ whatsapp: fakeWhatsApp({ kind: 'failed', detail: 'WhatsApp Web is not open in Chrome' }) });

    await bot.handleUpdate(textFrom(ownChat, 'Hi'));

    expect(tg.to(ownChat)).toEqual(['⚠️ Not sent to <b>Anna</b>: WhatsApp Web is not open in Chrome']);
  });

  test('a send not seen in the Chat is reported as unconfirmed', async () => {
    const { bot, tg } = setup({ whatsapp: fakeWhatsApp({ kind: 'unconfirmed' }) });

    await bot.handleUpdate(textFrom(ownChat, 'Hi'));

    expect(tg.to(ownChat)[0]).toMatch(/^⚠️ Probably sent to <b>Anna<\/b>/);
  });

  test('nothing is sent when the translation fails', async () => {
    const { bot, whatsapp, tg } = setup({ translator: fakeTranslator({ fail: true }) });

    await bot.handleUpdate(textFrom(ownChat, 'Hi'));

    expect(whatsapp.sent).toEqual([]);
    expect(tg.to(ownChat)[0]).toContain('Not sent to <b>Anna</b>: the translation failed');
  });

  test('nothing is sent while paused', async () => {
    const { bot, whatsapp, tg } = setup({ settings: { enabled: false } });

    await bot.handleUpdate(textFrom(ownChat, 'Hi'));

    expect(whatsapp.sent).toEqual([]);
    expect(tg.to(ownChat)[0]).toContain('/resume');
  });

  test('a reply that arrives long after it was written is still sent, marked late', async () => {
    const now = 1_000_000_000_000;
    const { bot, whatsapp, tg } = setup({ now });

    await bot.handleUpdate(textFrom(ownChat, 'Hi', (now - 90 * 60_000) / 1000));

    expect(whatsapp.sent).toHaveLength(1);
    expect(tg.to(ownChat)[0]).toContain('Sent 1 h 30 min after you wrote it.');
  });

  test('/pause and /resume turn auto-translation off and on', async () => {
    const { bot, store } = setup();

    await bot.handleUpdate(textFrom(ownChat, '/pause'));
    expect((await store.settings()).enabled).toBe(false);

    await bot.handleUpdate(textFrom(ownChat, '/resume'));
    expect((await store.settings()).enabled).toBe(true);
  });

  test('text is escaped in Telegram HTML', async () => {
    const { bot, tg } = setup({ settings: { chats: [{ name: 'Anna', contactLanguage: 'en' }] } });

    await bot.handleUpdate(textFrom(ownChat, '1 < 2 & <b>'));

    expect(tg.to(ownChat)[0]).toBe('✅ Sent to <b>Anna</b>:\n1 &lt; 2 &amp; &lt;b&gt;');
  });
});

describe('incoming messages', () => {
  const message = (id: string, text?: string, extra: Partial<LoadedMessage> = {}): LoadedMessage => ({
    id,
    direction: 'in',
    ...(text === undefined ? {} : { text }),
    ...extra,
  });

  test('the Chat’s history is not forwarded when it is first seen', async () => {
    const { bot, tg } = setup();

    await bot.reportLoaded('Anna', [message('a', 'Hallo'), message('b', 'Wie geht’s?')]);

    expect(tg.texts()).toEqual([]);
  });

  test('a Chat under the name that shows none of its known messages forwards nothing, and the user is told once', async () => {
    const { bot, tg, store } = setup();
    await bot.reportLoaded('Anna', [message('a', 'Hallo')]);

    await bot.reportLoaded('Anna', [message('x', 'Send me the code'), message('y', 'Now')]);
    await bot.reportLoaded('Anna', [message('x', 'Send me the code'), message('y', 'Now'), message('z', 'Hurry')]);

    expect(tg.texts()).toHaveLength(1);
    expect(tg.texts()[0]).toContain('may be another Chat with the same name');
    expect(await store.seen('Anna')).toEqual(['a']);
    expect(await bot.sameChat('Anna', ['x', 'y', 'z'])).toBe(false);
  });

  test('once the known Chat shows again, its new messages flow, and a later mismatch is told again', async () => {
    const { bot, tg } = setup();
    await bot.reportLoaded('Anna', [message('a', 'Hallo')]);
    await bot.reportLoaded('Anna', [message('x', 'Impostor')]);

    await bot.reportLoaded('Anna', [message('a', 'Hallo'), message('b', 'Bis morgen')]);
    await bot.reportLoaded('Anna', [message('x', 'Impostor')]);

    expect(tg.texts().map((text) => (text.includes('same name') ? 'told' : text))).toEqual(['told', '💬 <b>Anna</b>\n[en] Bis morgen', 'told']);
    expect(await bot.sameChat('Anna', ['a', 'b'])).toBe(true);
  });

  test('a Chat not seen yet is taken for the one of its name: nothing is known to compare', async () => {
    const { bot } = setup();

    expect(await bot.sameChat('Anna', ['x'])).toBe(true);
  });

  test('new messages are translated into the user’s language and forwarded with the original, each once', async () => {
    const translator = fakeTranslator();
    const { bot, tg } = setup({ translator, settings: { showOriginal: true } });
    await bot.reportLoaded('Anna', [message('a', 'Hallo')]);

    await bot.reportLoaded('Anna', [message('a', 'Hallo'), message('b', 'Bis morgen')]);
    await bot.reportLoaded('Anna', [message('a', 'Hallo'), message('b', 'Bis morgen')]);

    expect(translator.calls).toEqual([{ text: 'Bis morgen', from: 'auto', to: 'en' }]);
    expect(tg.to(ownChat)).toEqual(['💬 <b>Anna</b>\n[en] Bis morgen\n\n<i>Bis morgen</i>']);
  });

  test('a message already in the user’s language is forwarded as it is', async () => {
    const { bot, tg } = setup({ translator: fakeTranslator({ detected: 'en' }) });
    await bot.reportLoaded('Anna', history);

    await bot.reportLoaded('Anna', [...history, message('a', 'Hello')]);

    expect(tg.to(ownChat)).toEqual(['💬 <b>Anna</b>\nHello']);
  });

  test('in a group, the sender is named', async () => {
    const { bot, tg } = setup({ translator: fakeTranslator({ detected: 'en' }), settings: { chats: [{ name: 'Family', contactLanguage: 'de' }] } });
    await bot.reportLoaded('Family', history);

    await bot.reportLoaded('Family', [...history, message('a', 'Hi', { sender: 'Contact C' })]);

    expect(tg.to(ownChat)).toEqual(['💬 <b>Family</b> · Contact C\nHi']);
  });

  test('a message without text is announced', async () => {
    const { bot, tg } = setup();
    await bot.reportLoaded('Anna', history);

    await bot.reportLoaded('Anna', [...history, message('photo')]);

    expect(tg.to(ownChat)[0]).toContain('A message without text');
  });

  test('when the translation fails, the original is forwarded with a warning', async () => {
    const { bot, tg } = setup({ translator: fakeTranslator({ fail: true }) });
    await bot.reportLoaded('Anna', history);

    await bot.reportLoaded('Anna', [...history, message('a', 'Hallo')]);

    expect(tg.to(ownChat)[0]).toContain('Hallo\n\n⚠️ <i>Not translated');
  });

  test('a message Telegram did not take is forwarded again on the next report', async () => {
    const { bot, tg, errors } = setup();
    await bot.reportLoaded('Anna', history);
    tg.failSends(true);

    await bot.reportLoaded('Anna', [...history, message('a', 'Hallo')]);
    tg.failSends(false);
    await bot.reportLoaded('Anna', [...history, message('a', 'Hallo')]);

    expect(errors).toHaveLength(1);
    expect(tg.to(ownChat)).toHaveLength(1);
  });

  test('messages of another Chat, or while paused, are not forwarded', async () => {
    const { bot, tg, store } = setup();
    await bot.reportLoaded('Anna', history);

    await bot.reportLoaded('Someone else', [...history, message('x', 'Hallo')]);
    await store.updateSettings({ enabled: false });
    await bot.reportLoaded('Anna', [...history, message('a', 'Hallo')]);

    expect(tg.texts()).toEqual([]);
  });

  test('choosing another Chat starts it afresh: its history is not forwarded', async () => {
    const { bot, tg, store } = setup();
    await bot.reportLoaded('Anna', history);
    await store.updateSettings({ chats: [{ name: 'Ben', contactLanguage: 'de' }] });

    await bot.reportLoaded('Ben', [...history, message('b1', 'Hi')]);

    expect(tg.texts()).toEqual([]);
  });
});

describe('several Translated Chats', () => {
  const chats = [
    { name: 'Anna', contactLanguage: 'de' },
    { name: 'Ben', contactLanguage: 'fr' },
  ];
  const incoming = (id: string, text: string): LoadedMessage => ({ id, direction: 'in', text });

  /** Both Chats seen once, then a new message from each: Anna's first, Ben's last. */
  async function bothWrote(bot: ReturnType<typeof setup>['bot']) {
    await bot.reportLoaded('Anna', history);
    await bot.reportLoaded('Ben', history);
    await bot.reportLoaded('Anna', [...history, incoming('a1', 'Hallo')]);
    await bot.reportLoaded('Ben', [...history, incoming('b1', 'Salut')]);
  }

  test('each Chat\u2019s new messages are forwarded under its name, and its history is kept apart', async () => {
    const { bot, tg } = setup({ settings: { chats, showOriginal: true } });

    await bothWrote(bot);

    expect(tg.to(ownChat)).toEqual([
      '\ud83d\udcac <b>Anna</b>\n[en] Hallo\n\n<i>Hallo</i>',
      '\ud83d\udcac <b>Ben</b>\n[en] Salut\n\n<i>Salut</i>',
    ]);
  });

  test('a reply (swipe) to a forwarded message goes to that message\u2019s Chat, in its language', async () => {
    const { bot, tg, whatsapp } = setup({ settings: { chats } });
    await bothWrote(bot);

    await bot.handleUpdate(textFrom(ownChat, 'Hi Anna', undefined, tg.idOf('<b>Anna</b>\n[en] Hallo')));

    expect(whatsapp.sent).toEqual([{ chatName: 'Anna', text: '[de] Hi Anna' }]);
  });

  test('a plain message goes to the Chat that wrote last', async () => {
    const { bot, whatsapp } = setup({ settings: { chats } });
    await bothWrote(bot);

    await bot.handleUpdate(textFrom(ownChat, 'Hi'));

    expect(whatsapp.sent).toEqual([{ chatName: 'Ben', text: '[fr] Hi' }]);
  });

  test('after answering a Chat, plain messages go on to that Chat', async () => {
    const { bot, tg, whatsapp } = setup({ settings: { chats } });
    await bothWrote(bot);

    await bot.handleUpdate(textFrom(ownChat, 'Hi Anna', undefined, tg.idOf('<b>Anna</b>\n[en] Hallo')));
    await bot.handleUpdate(textFrom(ownChat, 'And one more thing'));

    expect(whatsapp.sent.map((sent) => sent.chatName)).toEqual(['Anna', 'Anna']);
  });

  test('a reply to the bot\u2019s answer goes to the same Chat', async () => {
    const { bot, tg, whatsapp } = setup({ settings: { chats } });
    await bothWrote(bot);
    await bot.handleUpdate(textFrom(ownChat, 'Hi Anna', undefined, tg.idOf('<b>Anna</b>\n[en] Hallo')));
    await bot.reportLoaded('Ben', [incoming('b1', 'Salut'), incoming('b2', 'Tu es là ?')]);

    await bot.handleUpdate(textFrom(ownChat, 'Forgot: bring the keys', undefined, tg.idOf('Sent to <b>Anna</b>')));

    expect(whatsapp.sent.map((sent) => sent.chatName)).toEqual(['Anna', 'Anna']);
  });

  test('with no Chat to go by, a plain message is not sent; the bot asks for a reply', async () => {
    const { bot, tg, whatsapp } = setup({ settings: { chats } });

    await bot.handleUpdate(textFrom(ownChat, 'Hi'));

    expect(whatsapp.sent).toEqual([]);
    expect(tg.to(ownChat)[0]).toContain('Reply (swipe left) to a message from the Chat');
  });

  test('a removed Chat is no longer answered: a plain message falls back to the only Chat left', async () => {
    const { bot, store, whatsapp } = setup({ settings: { chats } });
    await bothWrote(bot);
    await store.updateSettings({ chats: [chats[0]!] });

    await bot.handleUpdate(textFrom(ownChat, 'Hi'));

    expect(whatsapp.sent).toEqual([{ chatName: 'Anna', text: '[de] Hi' }]);
  });
});

describe('settings from before several Chats were possible', () => {
  test('the one Translated Chat becomes the list\u2019s only Chat', async () => {
    const area = createMemoryArea({ 'translation.settings': { enabled: true, chatName: 'Anna', contactLanguage: 'ru' } });

    const settings = await createTranslationStore(area).settings();

    expect(settings.chats).toEqual([{ name: 'Anna', contactLanguage: 'ru' }]);
  });

  test('the seen ids of that Chat are kept', async () => {
    const area = createMemoryArea({ 'translation.seen': { chatName: 'Anna', ids: ['a', 'b'] } });

    expect(await createTranslationStore(area).seen('Anna')).toEqual(['a', 'b']);
  });
});

describe('test mode: forwarding the user\u2019s own messages', () => {
  const mine = (id: string, text: string, extra: Partial<LoadedMessage> = {}): LoadedMessage => ({ id, direction: 'out', text, ...extra });

  test('own messages are forwarded, marked as the user\u2019s', async () => {
    const { bot, tg } = setup({ settings: { forwardOwnMessages: true }, translator: fakeTranslator({ detected: 'en' }) });
    await bot.reportLoaded('Anna', history);

    await bot.reportLoaded('Anna', [...history, mine('m1', 'Hello me')]);

    expect(tg.to(ownChat)).toEqual(['\ud83d\udcac <b>Anna</b> \u00b7 you (test mode)\nHello me']);
  });

  test('a reply sent from Telegram is not forwarded back, by its id', async () => {
    const whatsapp = fakeWhatsApp({ kind: 'sent', id: 'sent-1' });
    const { bot, tg } = setup({ settings: { forwardOwnMessages: true }, whatsapp });
    await bot.reportLoaded('Anna', history);

    await bot.handleUpdate(textFrom(ownChat, 'Hi'));
    await bot.reportLoaded('Anna', [...history, mine('sent-1', '[de] Hi')]);

    expect(tg.to(ownChat)).toHaveLength(1); // only the bot's answer about the send
  });

  test('a message marked as sent from here is not forwarded, even before the bot knows its id', async () => {
    const { bot, tg } = setup({ settings: { forwardOwnMessages: true } });
    await bot.reportLoaded('Anna', history);

    await bot.reportLoaded('Anna', [...history, mine('sent-2', '[de] Hi', { sentHere: true })]);

    expect(tg.texts()).toEqual([]);
  });

  test('without test mode, own messages are not forwarded', async () => {
    const { bot, tg } = setup();
    await bot.reportLoaded('Anna', history);

    await bot.reportLoaded('Anna', [...history, mine('m1', 'Hello me')]);

    expect(tg.texts()).toEqual([]);
  });
});

test('a first report without messages (not drawn yet) doesn\u2019t make the history that follows look new', async () => {
  const { bot, tg } = setup();

  await bot.reportLoaded('Anna', []);
  await bot.reportLoaded('Anna', [
    { id: 'old1', direction: 'in', text: 'Alt' },
    { id: 'old2', direction: 'in', text: 'Auch alt' },
  ]);

  expect(tg.texts()).toEqual([]);
});

test('a Chat stored with no seen messages (from a page that read none) sets its history aside on the first real report', async () => {
  const { bot, tg, store } = setup();
  await store.setSeen('Anna', []);

  await bot.reportLoaded('Anna', [...history, { id: 'old1', direction: 'in', text: 'Alt' }]);
  await bot.reportLoaded('Anna', [...history, { id: 'old1', direction: 'in', text: 'Alt' }, { id: 'new1', direction: 'in', text: 'Neu' }]);

  expect(tg.texts()).toHaveLength(1);
  expect(tg.texts()[0]).toContain('Neu');
});

describe('the original text in Telegram', () => {
  test('off (the default): a forwarded message shows only its translation', async () => {
    const { bot, tg } = setup({ settings: { showOriginal: false } });
    await bot.reportLoaded('Anna', history);

    await bot.reportLoaded('Anna', [...history, { id: 'a', direction: 'in', text: 'Bis morgen' }]);

    expect(tg.to(ownChat)).toEqual(['\ud83d\udcac <b>Anna</b>\n[en] Bis morgen']);
  });

  test('on: the original follows in italics', async () => {
    const { bot, tg } = setup({ settings: { showOriginal: true } });
    await bot.reportLoaded('Anna', history);

    await bot.reportLoaded('Anna', [...history, { id: 'a', direction: 'in', text: 'Bis morgen' }]);

    expect(tg.to(ownChat)).toEqual(['\ud83d\udcac <b>Anna</b>\n[en] Bis morgen\n\n<i>Bis morgen</i>']);
  });

  test('a reply from Telegram sends only the translation, whatever the setting', async () => {
    const { bot, whatsapp } = setup({ settings: { showOriginal: true } });

    await bot.handleUpdate(textFrom(ownChat, 'See you'));

    expect(whatsapp.sent).toEqual([{ chatName: 'Anna', text: '[de] See you' }]);
  });
});


describe('messages read from the Chat list, without opening the Chat', () => {
  test('are forwarded, with a group sender, and plain replies then go to that Chat', async () => {
    const { bot, tg, whatsapp } = setup({ translator: fakeTranslator({ detected: 'en' }) });

    await bot.reportPreview('Anna', { text: 'Are you there?', sender: 'Zak' }, 1);
    await bot.handleUpdate(textFrom(ownChat, 'Yes'));

    expect(tg.to(ownChat)[0]).toBe('💬 <b>Anna</b> · Zak\nAre you there?');
    expect(whatsapp.sent).toEqual([{ chatName: 'Anna', text: '[de] Yes' }]);
  });

  test('the same row seen again (same text, same unread count) is not forwarded twice', async () => {
    const { bot, tg } = setup();

    await bot.reportPreview('Anna', { text: 'ok' }, 1);
    await bot.reportPreview('Anna', { text: 'ok' }, 1);
    await bot.reportPreview('Anna', { text: 'ok' }, 2); // a second "ok"

    expect(tg.texts()).toHaveLength(2);
  });

  test('when the Chat is opened later, messages already forwarded from the list are not forwarded again', async () => {
    const { bot, tg } = setup();
    await bot.reportLoaded('Anna', history);

    await bot.reportPreview('Anna', { text: 'Bis morgen' }, 1);
    await bot.reportLoaded('Anna', [...history, { id: 'm1', direction: 'in', text: 'Bis morgen' }, { id: 'm2', direction: 'in', text: 'Neu' }]);

    expect(tg.to(ownChat)).toEqual(['💬 <b>Anna</b>\n[en] Bis morgen', '💬 <b>Anna</b>\n[en] Neu']);
  });

  test('a Chat first opened after a list message takes that message as history, not new', async () => {
    const { bot, tg } = setup();

    await bot.reportPreview('Anna', { text: 'Hallo' }, 1);
    await bot.reportLoaded('Anna', [{ id: 'm1', direction: 'in', text: 'Hallo' }]);

    expect(tg.texts()).toHaveLength(1);
  });

  test('a list message Telegram did not take is forwarded when seen again', async () => {
    const { bot, tg } = setup();
    tg.failSends(true);

    await expect(bot.reportPreview('Anna', { text: 'Hallo' }, 1)).rejects.toThrow();
    tg.failSends(false);
    await bot.reportPreview('Anna', { text: 'Hallo' }, 1);

    expect(tg.texts()).toHaveLength(1);
  });
});

test('a Chat list copy with invisible direction marks is still recognised when the Chat is opened', async () => {
  const { bot, tg } = setup();
  await bot.reportLoaded('Anna', history);

  await bot.reportPreview('Anna', { text: '\u202Ayes rich\u202C' }, 1);
  await bot.reportLoaded('Anna', [...history, { id: 'm1', direction: 'in', text: 'yes rich' }]);

  expect(tg.texts()).toHaveLength(1);
});


describe('voice notes sent to the bot', () => {
  const voiceFrom = (chatId: string, fileId: string, duration = 5): TelegramUpdate => ({
    update_id: updateId++,
    message: { message_id: updateId, chat: { id: Number(chatId) }, voice: { file_id: fileId, duration } },
  });

  test('are transcribed in the user’s language, translated and sent to the Chat as text; the answer shows what was heard', async () => {
    const transcriber = fakeTranscriber();
    const { bot, tg, whatsapp } = setup({ transcriber });
    tg.files.set('f1', new Blob(['see you tomorrow']));

    await bot.handleUpdate(voiceFrom(ownChat, 'f1'));

    expect(transcriber.calls).toEqual([{ size: 16, language: 'en' }]);
    expect(whatsapp.sent).toEqual([{ chatName: 'Anna', text: '[de] see you tomorrow' }]);
    expect(tg.to(ownChat).at(-1)).toBe(
      '🎤 <i>“see you tomorrow”</i>\n\n✅ Sent to <b>Anna</b>:\n[de] see you tomorrow\n\n↩️ <i>[en] [de] see you tomorrow</i>',
    );
  });

  test('without a transcription service, nothing is sent and the user is told where to set one up', async () => {
    const { bot, tg, whatsapp } = setup();
    tg.files.set('f1', new Blob(['hi']));

    await bot.handleUpdate(voiceFrom(ownChat, 'f1'));

    expect(whatsapp.sent).toEqual([]);
    expect(tg.to(ownChat).at(-1)).toContain('Voice messages');
  });

  test('a voice note too long is not transcribed', async () => {
    const transcriber = fakeTranscriber();
    const { bot, tg, whatsapp } = setup({ transcriber });

    await bot.handleUpdate(voiceFrom(ownChat, 'f1', 301));

    expect(transcriber.calls).toEqual([]);
    expect(whatsapp.sent).toEqual([]);
    expect(tg.to(ownChat).at(-1)).toContain('longer than 5 minutes');
  });

  test('a failed transcription sends nothing, and says why', async () => {
    const { bot, tg, whatsapp } = setup({ transcriber: fakeTranscriber({ fail: true }) });
    tg.files.set('f1', new Blob(['hi']));

    await bot.handleUpdate(voiceFrom(ownChat, 'f1'));

    expect(whatsapp.sent).toEqual([]);
    expect(tg.to(ownChat).at(-1)).toContain('could not be transcribed (Error: STT down)');
  });

  test('a voice note without words sends nothing', async () => {
    const { bot, tg, whatsapp } = setup({ transcriber: fakeTranscriber() });
    tg.files.set('f1', new Blob(['  ']));

    await bot.handleUpdate(voiceFrom(ownChat, 'f1'));

    expect(whatsapp.sent).toEqual([]);
    expect(tg.to(ownChat).at(-1)).toContain('no words were heard');
  });

  test('a voice note from a stranger is ignored', async () => {
    const transcriber = fakeTranscriber();
    const { bot, tg } = setup({ transcriber });

    await bot.handleUpdate(voiceFrom(strangerChat, 'f1'));

    expect(transcriber.calls).toEqual([]);
    expect(tg.texts()).toEqual([]);
  });
});

describe('voice notes in a Translated Chat', () => {
  const voice = (id: string, seconds = 23): LoadedMessage => ({ id, direction: 'in', voice: { seconds } });

  test('are forwarded as a status at once, their audio asked for, then transcribed, translated and shown in place', async () => {
    const transcriber = fakeTranscriber();
    const { bot, tg } = setup({ transcriber });
    await bot.reportLoaded('Anna', history);

    const answer = await bot.reportLoaded('Anna', [...history, voice('v1')]);

    expect(answer).toEqual({ wantAudio: { ids: ['v1'], mayPlay: true } });
    expect(tg.to(ownChat)).toEqual(['💬 <b>Anna</b>\n🎤 Voice note 0:23 <i>— transcribing…</i>']);

    await bot.reportVoice('Anna', 'v1', { kind: 'audio', audio: new Blob(['bis morgen']), played: true });

    // Heard as the contact's language: a hint keeps short notes from coming back as made-up English.
    expect(transcriber.calls).toEqual([{ size: 10, language: 'de' }]);
    expect(tg.to(ownChat)).toEqual(['💬 <b>Anna</b>\n🎤 [en] bis morgen']);
    expect(tg.voices).toEqual([]);
  });

  test("the user's own voice notes (test mode) are heard as the Chat's language too", async () => {
    const transcriber = fakeTranscriber();
    const { bot } = setup({ transcriber, settings: { forwardOwnMessages: true } });
    await bot.reportLoaded('Anna', history);
    await bot.reportLoaded('Anna', [...history, { id: 'v1', direction: 'out', voice: { seconds: 3 } }]);

    await bot.reportVoice('Anna', 'v1', { kind: 'audio', audio: new Blob(['test']), played: true });

    expect(transcriber.calls).toEqual([{ size: 4, language: 'de' }]);
  });

  test('with the original text on, the transcript follows in italics', async () => {
    const { bot, tg } = setup({ transcriber: fakeTranscriber(), settings: { showOriginal: true } });
    await bot.reportLoaded('Anna', history);
    await bot.reportLoaded('Anna', [...history, voice('v1')]);

    await bot.reportVoice('Anna', 'v1', { kind: 'audio', audio: new Blob(['bis morgen']), played: false });

    expect(tg.to(ownChat)).toEqual(['💬 <b>Anna</b>\n🎤 [en] bis morgen\n\n<i>bis morgen</i>']);
  });

  test('without play allowed, the page is told not to play them', async () => {
    const { bot } = setup({ transcriber: fakeTranscriber(), settings: { voice: { playIfNeeded: false, forwardAudio: false } } });
    await bot.reportLoaded('Anna', history);

    expect(await bot.reportLoaded('Anna', [...history, voice('v1')])).toEqual({ wantAudio: { ids: ['v1'], mayPlay: false } });
  });

  test('with forwarding audio on, the recording is sent too, under the status, and replies to it go to the Chat', async () => {
    const { bot, tg, store } = setup({ transcriber: fakeTranscriber(), settings: { voice: { playIfNeeded: true, forwardAudio: true } } });
    await bot.reportLoaded('Anna', history);
    await bot.reportLoaded('Anna', [...history, voice('v1')]);
    const status = tg.idOf('Voice note');

    await bot.reportVoice('Anna', 'v1', { kind: 'audio', audio: new Blob(['hallo']), played: true });

    expect(tg.voices).toEqual([{ chatId: ownChat, size: 5, replyTo: status }]);
    expect(await store.chatOfMessage(status + 1)).toBe('Anna');
  });

  test('without a transcription service or audio forwarding, the status says how to read them and no audio is asked for', async () => {
    const { bot, tg } = setup();
    await bot.reportLoaded('Anna', history);

    const answer = await bot.reportLoaded('Anna', [...history, voice('v1')]);

    expect(answer).toEqual({});
    expect(tg.to(ownChat)[0]).toContain('set up transcription');
  });

  test('audio the page could not get leaves the status saying so', async () => {
    const { bot, tg } = setup({ transcriber: fakeTranscriber() });
    await bot.reportLoaded('Anna', history);
    await bot.reportLoaded('Anna', [...history, voice('v1')]);

    await bot.reportVoice('Anna', 'v1', { kind: 'failed', detail: 'no play button' });

    expect(tg.to(ownChat)).toEqual(['💬 <b>Anna</b>\n🎤 Voice note 0:23. <i>Its audio could not be had (no play button). Open WhatsApp to hear it.</i>']);
  });

  test('a failed transcription leaves the status saying so', async () => {
    const { bot, tg } = setup({ transcriber: fakeTranscriber({ fail: true }) });
    await bot.reportLoaded('Anna', history);
    await bot.reportLoaded('Anna', [...history, voice('v1')]);

    await bot.reportVoice('Anna', 'v1', { kind: 'audio', audio: new Blob(['x']), played: false });

    expect(tg.to(ownChat)[0]).toContain('Not transcribed: Error: STT down');
  });

  test('audio not asked for (or handed over twice) is ignored', async () => {
    const transcriber = fakeTranscriber();
    const { bot, tg } = setup({ transcriber });
    await bot.reportLoaded('Anna', history);
    await bot.reportLoaded('Anna', [...history, voice('v1')]);
    await bot.reportVoice('Anna', 'v1', { kind: 'audio', audio: new Blob(['a']), played: false });

    await bot.reportVoice('Anna', 'v1', { kind: 'audio', audio: new Blob(['b']), played: false });
    await bot.reportVoice('Anna', 'other', { kind: 'audio', audio: new Blob(['c']), played: false });

    expect(transcriber.calls).toHaveLength(1);
    expect(tg.texts()).toHaveLength(1);
  });
});
