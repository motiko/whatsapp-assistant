import { languages } from '../../core/translation/languages';
import { createTranslationStore, settingsStorageKey, type Pairing, type TranslationSettings } from '../../core/translation/store';
import { createTelegram } from '../../core/translation/telegram';
import { combobox } from './combobox';
import { formatCost, listModels, matchProviders, type Capability, type ModelChoice } from '../../core/translation/providers';
import { openModelBrowser } from './model-browser';
import { clearDebugLog, debugLogKeys, formatDebugLog, readDebugLog } from '../../core/translation/debug-log';
import type {
  ChatListAnswer,
  ChatListRequest,
  DiagnoseRequest,
  DiagnoseVoiceRequest,
  StartPairingRequest,
  WakeBotRequest,
} from '../../extension/messages';
import { botStatusKey, transcriberFor, translatorFor, type BotStatus } from '../../extension/translation-service';

/**
 * The options page: auto-translation's settings. Every field saves on change;
 * the page loads all of them first, so nothing is saved back empty.
 */
const store = createTranslationStore(chrome.storage.local);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const enabled = $<HTMLInputElement>('enabled');
const enabledWord = $('enabled-word');
const enableProblem = $('enable-problem');
const botStatus = $('bot-status');
const myLanguage = $<HTMLSelectElement>('my-language');
const chatList = $<HTMLUListElement>('chat-list');
const noChats = $('no-chats');
const newChat = $<HTMLInputElement>('new-chat');
const newChatLanguage = $<HTMLSelectElement>('new-chat-language');
const chatNames = $<HTMLDataListElement>('chat-names');
const forwardOwn = $<HTMLInputElement>('forward-own');
const showOriginal = $<HTMLInputElement>('show-original');
const chatsHint = $('chats-hint');
const llmFields = $('llm-fields');
const llmBaseUrl = $<HTMLInputElement>('llm-base-url');
const llmModel = $<HTMLInputElement>('llm-model');
const llmApiKey = $<HTMLInputElement>('llm-api-key');
const testResult = $('test-result');
const sttBaseUrl = $<HTMLInputElement>('stt-base-url');
const sttModel = $<HTMLInputElement>('stt-model');
const sttApiKey = $<HTMLInputElement>('stt-api-key');
const sttResult = $('stt-result');
const voicePlay = $<HTMLInputElement>('voice-play');
const voiceForward = $<HTMLInputElement>('voice-forward');
const telegramToken = $<HTMLInputElement>('telegram-token');
const tokenResult = $('token-result');
const linkState = $('link-state');
const linkButton = $<HTMLButtonElement>('link');
const unlinkButton = $<HTMLButtonElement>('unlink');
const pairingBox = $('pairing');
const pairingCode = $('pairing-code');
const pairingLink = $<HTMLAnchorElement>('pairing-link');
const translatorRadios = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="translator"]'));

function fillLanguages(select: HTMLSelectElement) {
  for (const language of languages) select.add(new Option(`${language.name} (${language.code})`, language.code));
}
fillLanguages(myLanguage);
fillLanguages(newChatLanguage);
newChatLanguage.value = 'de';

let settings: TranslationSettings;

function note(element: HTMLElement, text: string, kind: '' | 'ok' | 'warn' = '') {
  element.textContent = text;
  element.className = `note ${kind}`.trim();
}

function render() {
  enabled.checked = settings.enabled;
  enabledWord.textContent = settings.enabled ? 'on' : 'off';
  ensureOption(myLanguage, settings.myLanguage);
  myLanguage.value = settings.myLanguage;
  forwardOwn.checked = settings.forwardOwnMessages;
  showOriginal.checked = settings.showOriginal;
  renderChats();
  for (const radio of translatorRadios) radio.checked = radio.value === settings.translator;
  llmFields.hidden = settings.translator !== 'llm';
  llmBaseUrl.value = settings.llm.baseUrl;
  llmModel.value = settings.llm.model;
  llmApiKey.value = settings.llm.apiKey;
  sttBaseUrl.value = settings.transcriber.baseUrl;
  sttModel.value = settings.transcriber.model;
  sttApiKey.value = settings.transcriber.apiKey;
  voicePlay.checked = settings.voice.playIfNeeded;
  voiceForward.checked = settings.voice.forwardAudio;
  telegramToken.value = settings.telegramToken;
  const linked = settings.telegramChatId !== '';
  note(linkState, linked ? `Linked to Telegram chat ${settings.telegramChatId}.` : 'Not linked yet.', linked ? 'ok' : '');
  linkButton.textContent = linked ? 'Link another Telegram chat' : 'Link my Telegram';
  unlinkButton.hidden = !linked;
  if (linked) pairingBox.hidden = true;
}

function renderChats() {
  noChats.hidden = settings.chats.length > 0;
  chatList.replaceChildren(
    ...settings.chats.map((chat) => {
      const item = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = chat.name;
      const language = document.createElement('select');
      language.setAttribute('aria-label', `${chat.name}: the contact's language`);
      fillLanguages(language);
      ensureOption(language, chat.contactLanguage);
      language.value = chat.contactLanguage;
      language.addEventListener('change', () =>
        void save({
          chats: settings.chats.map((other) => (other.name === chat.name ? { ...other, contactLanguage: language.value } : other)),
        }),
      );
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => {
        const chats = settings.chats.filter((other) => other.name !== chat.name);
        void save({ chats, ...(chats.length === 0 ? { enabled: false } : {}) });
      });
      item.append(name, language, remove);
      return item;
    }),
  );
}

/** A language code that isn't in the list (set some other way) still shows. */
function ensureOption(select: HTMLSelectElement, code: string) {
  if (!Array.from(select.options).some((option) => option.value === code)) select.add(new Option(code, code));
}

async function save(patch: Partial<TranslationSettings>) {
  await store.updateSettings(patch);
  settings = await store.settings();
  render();
  const wake: WakeBotRequest = { type: 'translation/wake' };
  await chrome.runtime.sendMessage(wake).catch(() => {});
}

/** What stops auto-translation from working with these settings, or undefined. */
async function missing(current: TranslationSettings): Promise<string | undefined> {
  if (current.chats.length === 0) return 'Add a Translated Chat first.';
  if (!current.telegramToken) return 'Add your Telegram bot’s token first.';
  if (!current.telegramChatId) return 'Link your Telegram chat first.';
  if (current.translator === 'llm') {
    if (!current.llm.apiKey) return 'Add the LLM’s API key first.';
    if (!(await hasLlmAccess(current))) return 'Click Test translator first, to let the extension reach the LLM’s API.';
  }
  return undefined;
}

function llmOrigin(current: TranslationSettings): string | undefined {
  try {
    return `${new URL(current.llm.baseUrl).origin}/*`;
  } catch {
    return undefined;
  }
}

async function hasLlmAccess(current: TranslationSettings): Promise<boolean> {
  const origin = llmOrigin(current);
  return origin !== undefined && chrome.permissions.contains({ origins: [origin] });
}

enabled.addEventListener('change', async () => {
  enableProblem.hidden = true;
  if (enabled.checked) {
    const problem = await missing(settings);
    if (problem) {
      enabled.checked = false;
      enableProblem.hidden = false;
      note(enableProblem, problem, 'warn');
      return;
    }
  }
  await save({ enabled: enabled.checked });
});

myLanguage.addEventListener('change', () => void save({ myLanguage: myLanguage.value }));
function addChat() {
  const name = newChat.value.trim();
  if (!name) return note(chatsHint, 'Type the Chat\u2019s name as WhatsApp Web shows it, or load the names from WhatsApp Web.', 'warn');
  if (settings.chats.some((chat) => chat.name === name)) return note(chatsHint, `\u201c${name}\u201d is already in the list.`, 'warn');
  newChat.value = '';
  note(chatsHint, '');
  void save({ chats: [...settings.chats, { name, contactLanguage: newChatLanguage.value }] });
}
$('add-chat').addEventListener('click', addChat);
forwardOwn.addEventListener('change', () => void save({ forwardOwnMessages: forwardOwn.checked }));
showOriginal.addEventListener('change', () => void save({ showOriginal: showOriginal.checked }));
newChat.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') addChat();
});
for (const radio of translatorRadios) {
  radio.addEventListener('change', () => void save({ translator: radio.value === 'llm' ? 'llm' : 'google' }));
}
for (const input of [llmBaseUrl, llmModel, llmApiKey]) {
  input.addEventListener('change', async () => {
    await save({ llm: { baseUrl: llmBaseUrl.value.trim(), model: llmModel.value.trim(), apiKey: llmApiKey.value.trim() } });
    if (input !== llmModel) void llmModels.load(true);
  });
}

for (const input of [sttBaseUrl, sttModel, sttApiKey]) {
  input.addEventListener('change', async () => {
    await save({ transcriber: { baseUrl: sttBaseUrl.value.trim(), model: sttModel.value.trim(), apiKey: sttApiKey.value.trim() } });
    if (input !== sttModel) void sttModels.load(true);
  });
}

/** Suggests the known providers offering `capability` in a base URL field (typing “open” shows OpenRouter and OpenAI). */
function suggestProviders(field: HTMLInputElement, capability: Capability) {
  combobox(field).setOptions(matchProviders('', capability).map((provider) => ({ value: provider.baseUrl, label: provider.name })));
}
suggestProviders(llmBaseUrl, 'chat');
suggestProviders(sttBaseUrl, 'transcription');

/**
 * Suggests, in a model field, the models the configured API offers for
 * `capability`, once its base URL and key are set. `ask`: in a user's action,
 * so Chrome may be asked for access to the API's origin.
 */
function modelSuggestions(
  capability: Capability,
  config: () => { baseUrl: string; apiKey: string },
  field: HTMLInputElement,
  status: HTMLElement,
) {
  const list = combobox(field);
  let loaded = '';
  let models: ModelChoice[] = [];
  const browse = document.createElement('button');
  browse.type = 'button';
  browse.className = 'link';
  browse.textContent = 'Compare models';
  browse.hidden = true;
  status.after(browse);
  browse.addEventListener('click', () =>
    openModelBrowser({
      capability,
      models,
      current: field.value.trim(),
      onPick(id) {
        field.value = id;
        field.dispatchEvent(new Event('change', { bubbles: true }));
      },
    }),
  );
  async function load(ask: boolean) {
    const { baseUrl, apiKey } = config();
    let origin: string;
    try {
      origin = `${new URL(baseUrl).origin}/*`;
    } catch {
      list.setOptions([]);
      browse.hidden = true;
      return note(status, '');
    }
    if (!apiKey) {
      list.setOptions([]);
      browse.hidden = true;
      return note(status, 'Add the API key to pick from its models.');
    }
    const key = `${baseUrl}\n${apiKey}`;
    if (key === loaded) return;
    const allowed = ask
      ? await chrome.permissions.request({ origins: [origin] }).catch(() => false)
      : await chrome.permissions.contains({ origins: [origin] });
    if (!allowed) return note(status, `Click the model field to let the extension reach ${new URL(baseUrl).host} and list its models.`);
    note(status, 'Loading models…');
    try {
      models = await listModels({ baseUrl, apiKey }, capability);
      list.setOptions(
        models.map((model) => ({
          value: model.id,
          ...(model.name ? { label: model.name } : {}),
          ...(model.cost !== undefined ? { detail: `${formatCost(model.cost)} / 100` } : {}),
        })),
      );
      browse.hidden = models.length === 0;
      loaded = key;
      note(
        status,
        models.length
          ? `${models.length} ${capability === 'chat' ? 'chat' : 'speech-to-text'} models: type in the field to search them, or compare them by price.`
          : `The API lists no ${capability === 'chat' ? 'chat' : 'speech-to-text'} models; type the model’s name.`,
        models.length ? 'ok' : 'warn',
      );
    } catch (error) {
      note(status, `Could not list the models: ${error instanceof Error ? error.message : String(error)}`, 'warn');
    }
  }
  // A click is a user's action: access to the API may be asked for in it.
  field.addEventListener('click', () => void load(true));
  return { load };
}
const llmModels = modelSuggestions(
  'chat',
  () => ({ baseUrl: settings.llm.baseUrl, apiKey: settings.llm.apiKey }),
  llmModel,
  $('llm-models-note'),
);
const sttModels = modelSuggestions(
  'transcription',
  () => ({ baseUrl: settings.transcriber.baseUrl, apiKey: settings.transcriber.apiKey }),
  sttModel,
  $('stt-models-note'),
);
for (const box of [voicePlay, voiceForward]) {
  box.addEventListener('change', () => void save({ voice: { playIfNeeded: voicePlay.checked, forwardAudio: voiceForward.checked } }));
}

$('test-transcriber').addEventListener('click', async () => {
  const transcriber = transcriberFor(settings);
  if (!transcriber) return note(sttResult, 'Fill in the base URL, model and API key first.', 'warn');
  let origin: string;
  try {
    origin = `${new URL(settings.transcriber.baseUrl).origin}/*`;
  } catch {
    return note(sttResult, 'The API base URL is not a valid URL.', 'warn');
  }
  // Asked for here, inside a click, as Chrome requires.
  const granted = await chrome.permissions.request({ origins: [origin] }).catch(() => false);
  if (!granted) return note(sttResult, `The extension needs access to ${origin} to transcribe.`, 'warn');
  note(sttResult, 'Transcribing a second of silence…');
  try {
    const { text } = await transcriber.transcribe(silentWav(), { language: settings.myLanguage });
    note(sttResult, text ? `It works (it heard “${text}” in a second of silence).` : 'It works.', 'ok');
  } catch (error) {
    note(sttResult, String(error), 'warn');
  }
});

/** One second of silence as a WAV file (16 kHz, 16-bit mono), to test a transcription service. */
function silentWav(): Blob {
  const rate = 16_000;
  const data = rate * 2;
  const view = new DataView(new ArrayBuffer(44 + data));
  const text = (offset: number, value: string) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + data, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, data, true);
  return new Blob([view.buffer], { type: 'audio/wav' });
}

$('load-chats').addEventListener('click', async () => {
  const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  const request: ChatListRequest = { type: 'translation/chat-list' };
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    const answer = (await chrome.tabs.sendMessage(tab.id, request, { frameId: 0 }).catch(() => undefined)) as
      | ChatListAnswer
      | undefined;
    if (!answer) continue;
    const names = [...new Set([...(answer.open ? [answer.open] : []), ...answer.names])];
    chatNames.replaceChildren(...names.map((name) => new Option(name)));
    note(
      chatsHint,
      names.length
        ? `${names.length} Chat names loaded: click the name field to pick one${answer.open ? ` (open now: ${answer.open})` : ''}. Only Chats near the top of the Chat list are listed; type any other name.`
        : 'WhatsApp Web shows no Chats yet. Wait until it has loaded, then try again.',
    );
    return;
  }
  note(chatsHint, 'No WhatsApp Web tab answered. Open (or reload) https://web.whatsapp.com and try again.', 'warn');
});

$('test-translator').addEventListener('click', async () => {
  note(testResult, 'Translating…');
  if (settings.translator === 'llm') {
    const origin = llmOrigin(settings);
    if (!origin) return note(testResult, 'The API base URL is not a valid URL.', 'warn');
    // Asked for here, inside a click, as Chrome requires.
    const granted = await chrome.permissions.request({ origins: [origin] }).catch(() => false);
    if (!granted) return note(testResult, `The extension needs access to ${origin} to use the LLM.`, 'warn');
  }
  try {
    const sample = 'Hello! Can we meet tomorrow at noon?';
    const result = await translatorFor(settings).translate(sample, 'en', settings.chats[0]?.contactLanguage ?? newChatLanguage.value);
    note(testResult, `“${sample}” → “${result.text}”`, 'ok');
  } catch (error) {
    note(testResult, String(error), 'warn');
  }
});

/** The bot's username for the token in the field, checking the token; undefined (with a note) if it is wrong. */
async function checkToken(): Promise<string | undefined> {
  const token = telegramToken.value.trim();
  if (!token) {
    note(tokenResult, 'Paste the token @BotFather gave you.', 'warn');
    return undefined;
  }
  note(tokenResult, 'Checking…');
  try {
    const username = await createTelegram(token).username();
    note(tokenResult, `Bot @${username} found.`, 'ok');
    return username;
  } catch (error) {
    note(tokenResult, `That token doesn’t work: ${String(error)}`, 'warn');
    return undefined;
  }
}

telegramToken.addEventListener('change', async () => {
  const token = telegramToken.value.trim();
  if (token === settings.telegramToken) return;
  // Another bot: its chat must be linked again, and its updates start afresh.
  await store.setOffset(0);
  await save({ telegramToken: token, telegramChatId: '', enabled: false });
  if (token) await checkToken();
});
$('check-token').addEventListener('click', () => void checkToken());

linkButton.addEventListener('click', async () => {
  const username = await checkToken();
  if (!username) return;
  const request: StartPairingRequest = { type: 'translation/start-pairing' };
  const pairing = (await chrome.runtime.sendMessage(request)) as Pairing | { ok: false; error: string };
  if (!('code' in pairing)) return note(linkState, `Could not start linking: ${pairing.error}`, 'warn');
  pairingCode.textContent = pairing.code;
  pairingLink.href = `https://t.me/${username}?start=${pairing.code}`;
  pairingLink.textContent = `@${username}`;
  pairingBox.hidden = false;
  note(linkState, 'Waiting for the code…');
});

unlinkButton.addEventListener('click', () => void save({ telegramChatId: '', enabled: false }));

// The bot links the chat (and /pause, /resume change settings) while this page is open.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  if (settingsStorageKey in changes) {
    settings = await store.settings();
    render();
  }
  if (botStatusKey in changes) showBotStatus(changes[botStatusKey]?.newValue as BotStatus | undefined);
  if (Object.values(debugLogKeys).some((key) => key in changes)) void showDebugLog();
});

const debugLog = $('debug-log');
const logNote = $('log-note');
async function showDebugLog() {
  const text = formatDebugLog(await readDebugLog(chrome.storage.local));
  debugLog.textContent = text || 'Nothing yet.';
  debugLog.scrollTop = debugLog.scrollHeight;
}
$('copy-log').addEventListener('click', async () => {
  await navigator.clipboard.writeText(debugLog.textContent ?? '');
  note(logNote, 'Copied.', 'ok');
});
const diagnosis = $('diagnosis');
const diagnosisNote = $('diagnosis-note');
const copyDiagnosis = $<HTMLButtonElement>('copy-diagnosis');
async function diagnose(request: DiagnoseRequest | DiagnoseVoiceRequest) {
  note(diagnosisNote, request.type === 'translation/diagnose-voice' ? 'Playing the last voice note\u2026' : 'Asking WhatsApp Web\u2026');
  const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    const answer = await chrome.tabs.sendMessage(tab.id, request, { frameId: 0 }).catch(() => undefined);
    if (!answer) continue;
    diagnosis.textContent = JSON.stringify(answer, null, 2);
    diagnosis.hidden = false;
    copyDiagnosis.hidden = false;
    note(diagnosisNote, '');
    return;
  }
  note(diagnosisNote, 'No WhatsApp Web tab answered. Open (or reload) https://web.whatsapp.com and try again.', 'warn');
}
$('diagnose').addEventListener('click', () => void diagnose({ type: 'translation/diagnose' }));
$('diagnose-voice').addEventListener('click', () => void diagnose({ type: 'translation/diagnose-voice' }));
copyDiagnosis.addEventListener('click', async () => {
  await navigator.clipboard.writeText(diagnosis.textContent ?? '');
  note(diagnosisNote, 'Copied.', 'ok');
});
$('clear-log').addEventListener('click', async () => {
  await clearDebugLog(chrome.storage.local);
  note(logNote, '');
});

function showBotStatus(status: BotStatus | undefined) {
  if (!settings.telegramToken) return note(botStatus, 'The Telegram bot is not set up yet.');
  if (status?.error && !status.lastPollAt) return note(botStatus, `The Telegram bot is not working: ${status.error}`, 'warn');
  if (status?.error) return note(botStatus, `The Telegram bot had a problem: ${status.error}`, 'warn');
  if (status?.lastPollAt) return note(botStatus, 'The Telegram bot is listening.', 'ok');
  note(botStatus, 'The Telegram bot is starting…');
}

settings = await store.settings();
render();
void llmModels.load(false);
void sttModels.load(false);
void showDebugLog();
showBotStatus((await chrome.storage.local.get(botStatusKey))[botStatusKey] as BotStatus | undefined);
