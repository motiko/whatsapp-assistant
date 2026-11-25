import { describe, expect, test } from 'vitest';
import { createChatWatcher, type ChatListRow, type ChatsPage, type ListPreview } from './chat-watcher';
import type { LoadedMessage } from './new-messages';
import type { ReportAnswer, SendOutcome, VoiceAudio } from './translation-bot';

/** A scripted WhatsApp Web: Chats with rows and messages, one of them open. */
function fakeChats(open: string | undefined) {
  const state = {
    open,
    rows: new Map<string, ChatListRow>(),
    messages: new Map<string, LoadedMessage[]>(),
    atNewest: true,
    opened: [] as string[],
    sent: [] as { chat: string; text: string }[],
    openFails: false,
    sendOutcome: { kind: 'sent' } as SendOutcome,
    /** Voice audio asked for: the Chat open then, the id, and whether it could be played. */
    voiceAsked: [] as { chat: string; id: string; mayPlay: boolean }[],
  };
  const page: ChatsPage = {
    openChatName: () => state.open,
    chatListNames: () => Array.from(state.rows.keys()),
    chatListRow: (name) => state.rows.get(name),
    async openChat(name) {
      if (state.openFails) throw new Error('no such Chat');
      state.open = name;
      state.opened.push(name);
    },
    atNewest: () => state.atNewest,
    async readMessages() {
      return state.messages.get(state.open ?? '') ?? [];
    },
    async sendMessage(text) {
      state.sent.push({ chat: state.open ?? '', text });
      if (state.sendOutcome.kind === 'sent' && state.sendOutcome.id) {
        const list = state.messages.get(state.open ?? '') ?? [];
        state.messages.set(state.open ?? '', [...list, { id: state.sendOutcome.id, direction: 'out', text }]);
      }
      return state.sendOutcome;
    },
    async voiceAudio(id, { mayPlay }) {
      state.voiceAsked.push({ chat: state.open ?? '', id, mayPlay });
      return { kind: 'audio', audio: new Blob([id]), played: mayPlay };
    },
    onChange: () => () => {},
  };
  return { page, state };
}

function setup(open: string | undefined, settings: { enabled: boolean; chatNames: string[] } = { enabled: true, chatNames: ['Anna'] }) {
  const chats = fakeChats(open);
  const reports: { chatName: string; ids: string[] }[] = [];
  const previews: { chatName: string; preview: ListPreview; unreadCount: number }[] = [];
  const voices: { chatName: string; id: string; audio: VoiceAudio }[] = [];
  let answer: ReportAnswer = {};
  let busy: string | undefined;
  let now = 0;
  let same = true;
  const sameAsked: { chatName: string; ids: string[] }[] = [];
  const watcher = createChatWatcher({
    page: chats.page,
    settings: async () => settings,
    async sameChat(chatName, ids) {
      sameAsked.push({ chatName, ids });
      return same;
    },
    async report(chatName, messages) {
      reports.push({ chatName, ids: messages.map((message) => message.id) });
      const given = answer;
      answer = {};
      return given;
    },
    async reportVoice(chatName, id, audio) {
      voices.push({ chatName, id, audio });
    },
    async reportPreview(chatName, preview, unreadCount) {
      previews.push({ chatName, preview, unreadCount });
    },
    busy: () => busy,
    now: () => now,
    logError: () => {},
  });
  return {
    watcher,
    ...chats,
    reports,
    previews,
    voices,
    sameAsked,
    /** Whether the bot takes the open Chat for the Translated Chat of its name. */
    setSame(value: boolean) {
      same = value;
    },
    /** What the bot answers to the next report. */
    answerNext(next: ReportAnswer) {
      answer = next;
    },
    setBusy(reason: string | undefined) {
      busy = reason;
    },
    advance(ms: number) {
      now += ms;
    },
  };
}

const msg = (id: string): LoadedMessage => ({ id, direction: 'in', text: id });

describe('the Chat Watcher, with the Translated Chat open', () => {
  test('reports its loaded messages', async () => {
    const { watcher, state, reports } = setup('Anna');
    state.messages.set('Anna', [msg('a'), msg('b')]);

    await watcher.check();

    expect(reports).toEqual([{ chatName: 'Anna', ids: ['a', 'b'] }]);
  });

  test('reports again only when the messages changed', async () => {
    const { watcher, state, reports } = setup('Anna');
    state.messages.set('Anna', [msg('a')]);

    await watcher.check();
    await watcher.check();
    state.messages.set('Anna', [msg('a'), msg('b')]);
    await watcher.check();

    expect(reports.map((report) => report.ids)).toEqual([['a'], ['a', 'b']]);
  });

  test('does not report while scrolled up, away from the newest messages', async () => {
    const { watcher, state, reports } = setup('Anna');
    state.messages.set('Anna', [msg('a')]);
    state.atNewest = false;

    await watcher.check();

    expect(reports).toEqual([]);
  });

  test('does nothing while auto-translation is off', async () => {
    const { watcher, state, reports } = setup('Anna', { enabled: false, chatNames: ['Anna'] });
    state.messages.set('Anna', [msg('a')]);

    await watcher.check();

    expect(reports).toEqual([]);
  });
});

describe('the Chat Watcher, with another Chat open', () => {
  test('opens the Translated Chat when its row shows unread messages, and reports', async () => {
    const { watcher, state, reports } = setup('Ben');
    state.rows.set('Anna', { text: 'Anna 10:02 Hallo', unread: true });
    state.messages.set('Anna', [msg('a')]);

    await watcher.check();

    expect(state.opened).toEqual(['Anna']);
    expect(reports).toEqual([{ chatName: 'Anna', ids: ['a'] }]);
  });

  test('leaves WhatsApp Web alone when the row changes without its unread count going up (typing, a message sent from the phone)', async () => {
    const { watcher, state, previews } = setup('Ben');
    state.rows.set('Anna', { text: 'Anna 10:02 Hallo', unread: false });

    await watcher.check();
    state.rows.set('Anna', { text: 'Anna typing\u2026', unread: false });
    await watcher.check();

    expect(state.opened).toEqual([]);
    expect(previews).toEqual([]);
  });

  test('one new plain-text message is taken from the Chat list, without opening the Chat', async () => {
    const { watcher, state, previews, reports } = setup('Ben');
    state.rows.set('Anna', { text: 'Anna 10:02 Hallo', unread: false });
    await watcher.check();

    state.rows.set('Anna', { text: 'Anna 10:05 Bist du da? 1', unread: true, unreadCount: 1, preview: { text: 'Bist du da?' } });
    await watcher.check();

    expect(state.opened).toEqual([]);
    expect(reports).toEqual([]);
    expect(previews).toEqual([{ chatName: 'Anna', preview: { text: 'Bist du da?' }, unreadCount: 1 }]);
  });

  test('each further single message is taken from the Chat list too', async () => {
    const { watcher, state, previews } = setup('Ben');
    state.rows.set('Anna', { text: 'a', unread: true, unreadCount: 1, preview: { text: 'Eins' } });
    await watcher.check();

    state.rows.set('Anna', { text: 'b', unread: true, unreadCount: 2, preview: { text: 'Zwei' } });
    await watcher.check();

    expect(state.opened).toEqual([]);
    expect(previews.map((preview) => preview.preview.text)).toEqual(['Eins', 'Zwei']);
  });

  test('opens the Chat when several messages came at once: the row shows only the last', async () => {
    const { watcher, state, previews } = setup('Ben');
    state.rows.set('Anna', { text: 'a', unread: false });
    await watcher.check();

    state.rows.set('Anna', { text: 'b', unread: true, unreadCount: 3, preview: { text: 'Drei' } });
    await watcher.check();

    expect(state.opened).toEqual(['Anna']);
    expect(previews).toEqual([]);
  });

  test('opens the Chat when the new message isn\u2019t plain text (a photo, a voice note)', async () => {
    const { watcher, state, previews } = setup('Ben');
    state.rows.set('Anna', { text: 'a', unread: false });
    await watcher.check();

    state.rows.set('Anna', { text: 'Photo', unread: true, unreadCount: 1 });
    await watcher.check();

    expect(state.opened).toEqual(['Anna']);
    expect(previews).toEqual([]);
  });

  test('leaves WhatsApp Web alone while its row shows nothing new', async () => {
    const { watcher, state } = setup('Ben');
    state.rows.set('Anna', { text: 'Anna 10:02 Hallo', unread: false });

    await watcher.check();
    await watcher.check();

    expect(state.opened).toEqual([]);
  });

  test('never switches Chats while busy (a Chat Record is being made)', async () => {
    const { watcher, state, setBusy } = setup('Ben');
    state.rows.set('Anna', { text: 'Anna', unread: true });
    setBusy('recording');

    await watcher.check();

    expect(state.opened).toEqual([]);
  });

  test('after failing to open the Chat, waits a minute before trying again', async () => {
    const { watcher, state, advance } = setup('Ben');
    state.rows.set('Anna', { text: 'Anna', unread: true });
    state.openFails = true;

    await watcher.check();
    state.openFails = false;
    await watcher.check();
    expect(state.opened).toEqual([]);

    advance(60_000);
    await watcher.check();
    expect(state.opened).toEqual(['Anna']);
  });
});

describe('sending through the Chat Watcher', () => {
  test('opens the Chat, sends, and goes back to the Chat that was open', async () => {
    const { watcher, state } = setup('Ben');

    const outcome = await watcher.send('Anna', 'Hallo');

    expect(outcome).toEqual({ kind: 'sent' });
    expect(state.sent).toEqual([{ chat: 'Anna', text: 'Hallo' }]);
    expect(state.opened).toEqual(['Anna', 'Ben']);
    expect(state.open).toBe('Ben');
  });

  test('checks the opened Chat is the known one, by its messages, before sending', async () => {
    const { watcher, state, sameAsked } = setup('Ben');
    state.messages.set('Anna', [msg('a1'), msg('a2')]);

    await watcher.send('Anna', 'Hallo');

    expect(sameAsked).toEqual([{ chatName: 'Anna', ids: ['a1', 'a2'] }]);
  });

  test('sends nothing to a Chat that only shares the name', async () => {
    const { watcher, state, setSame } = setup('Ben');
    setSame(false);

    const outcome = await watcher.send('Anna', 'Hallo');

    expect(outcome.kind).toBe('failed');
    expect(outcome.kind === 'failed' && outcome.detail).toContain('another Chat with the same name');
    expect(state.sent).toEqual([]);
    expect(state.open).toBe('Ben');
  });

  test('stays in the Chat when it was already open', async () => {
    const { watcher, state } = setup('Anna');

    await watcher.send('Anna', 'Hallo');

    expect(state.opened).toEqual([]);
  });

  test('fails, without touching WhatsApp Web, while busy', async () => {
    const { watcher, state, setBusy } = setup('Ben');
    setBusy('a Chat Record is being made');

    const outcome = await watcher.send('Anna', 'Hallo');

    expect(outcome).toEqual({ kind: 'failed', detail: 'a Chat Record is being made' });
    expect(state.opened).toEqual([]);
    expect(state.sent).toEqual([]);
  });

  test('fails when the Chat cannot be opened', async () => {
    const { watcher, state } = setup('Ben');
    state.openFails = true;

    const outcome = await watcher.send('Anna', 'Hallo');

    expect(outcome.kind).toBe('failed');
    expect(state.sent).toEqual([]);
  });

  test('sends in the order asked', async () => {
    const { watcher, state } = setup('Anna');

    await Promise.all([watcher.send('Anna', 'one'), watcher.send('Anna', 'two'), watcher.send('Anna', 'three')]);

    expect(state.sent.map((sent) => sent.text)).toEqual(['one', 'two', 'three']);
  });
});

describe('the Chat Watcher, with several Translated Chats', () => {
  const both = { enabled: true, chatNames: ['Anna', 'Ben'] };

  test('reports the open one and opens another with a new message that isn\u2019t plain text', async () => {
    const { watcher, state, reports } = setup('Anna', both);
    state.messages.set('Anna', [msg('a1')]);
    state.messages.set('Ben', [msg('b1')]);
    state.rows.set('Anna', { text: 'Anna 10:00', unread: false });
    state.rows.set('Ben', { text: 'Ben 09:00', unread: false });

    await watcher.check();
    state.rows.set('Ben', { text: 'Ben 10:05 Salut', unread: true });
    await watcher.check();

    expect(state.opened).toEqual(['Ben']);
    expect(reports).toEqual([
      { chatName: 'Anna', ids: ['a1'] },
      { chatName: 'Ben', ids: ['b1'] },
    ]);
  });

  test('with news in two Chats, opens one per check, then the other', async () => {
    const { watcher, state } = setup('Other', both);
    state.rows.set('Anna', { text: 'Anna', unread: true });
    state.rows.set('Ben', { text: 'Ben', unread: true });

    await watcher.check();
    await watcher.check();

    expect(state.opened).toEqual(['Anna', 'Ben']);
  });

  test('unread badges that stay don\u2019t make it switch back and forth', async () => {
    const { watcher, state } = setup('Anna', both);
    // WhatsApp Web in a background tab may never clear these badges.
    state.rows.set('Anna', { text: 'Anna', unread: true });
    state.rows.set('Ben', { text: 'Ben', unread: true });

    for (let n = 0; n < 4; n++) await watcher.check();

    expect(state.opened).toEqual(['Ben']);
  });

  test('a Chat that is no longer translated is left alone', async () => {
    const { watcher, state } = setup('Anna', { enabled: true, chatNames: ['Anna'] });
    state.rows.set('Ben', { text: 'Ben', unread: true });

    await watcher.check();

    expect(state.opened).toEqual([]);
  });
});

test('the Chat Watcher marks the messages it sent, so they are never forwarded back', async () => {
  const chats = fakeChats('Anna');
  chats.state.sendOutcome = { kind: 'sent', id: 'out-1' };
  chats.state.messages.set('Anna', [msg('a')]);
  const reported: LoadedMessage[][] = [];
  const watcher = createChatWatcher({
    page: chats.page,
    settings: async () => ({ enabled: true, chatNames: ['Anna'] }),
    sameChat: async () => true,
    async report(_chatName, messages) {
      reported.push(messages);
    },
    async reportPreview() {},
    logError: () => {},
  });

  await watcher.send('Anna', 'Hallo');
  await watcher.check();

  expect(reported.at(-1)).toEqual([msg('a'), { id: 'out-1', direction: 'out', text: 'Hallo', sentHere: true }]);
});

describe('voice notes', () => {
  test('the audio of the voice notes the bot asks for is fetched while their Chat is open, and handed over', async () => {
    const { watcher, state, voices, answerNext } = setup('Anna');
    state.messages.set('Anna', [msg('a'), { id: 'v1', direction: 'in', voice: { seconds: 4 } }]);
    answerNext({ wantAudio: { ids: ['v1'], mayPlay: true } });

    await watcher.check();

    expect(state.voiceAsked).toEqual([{ chat: 'Anna', id: 'v1', mayPlay: true }]);
    expect(voices.map((voice) => [voice.chatName, voice.id, voice.audio.kind])).toEqual([['Anna', 'v1', 'audio']]);
  });

  test('when a send opened the Chat, the audio is fetched there before going back', async () => {
    const { watcher, state, answerNext } = setup('Other');
    state.messages.set('Anna', [{ id: 'v1', direction: 'in', voice: {} }]);
    answerNext({ wantAudio: { ids: ['v1'], mayPlay: false } });

    await watcher.send('Anna', 'Hallo');

    expect(state.voiceAsked).toEqual([{ chat: 'Anna', id: 'v1', mayPlay: false }]);
    expect(state.open).toBe('Other');
  });

  test('a page that fails to get the audio is reported as a failure, not dropped', async () => {
    const { watcher, state, page, voices, answerNext } = setup('Anna');
    page.voiceAudio = async () => {
      throw new Error('no play button');
    };
    state.messages.set('Anna', [{ id: 'v1', direction: 'in', voice: {} }]);
    answerNext({ wantAudio: { ids: ['v1'], mayPlay: true } });

    await watcher.check();

    expect(voices[0]!.audio).toEqual({ kind: 'failed', detail: 'no play button' });
  });
});
