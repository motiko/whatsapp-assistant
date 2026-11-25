/** A language the settings offer, by the code Google Translate uses for it. */
export interface Language {
  code: string;
  name: string;
}

/** The languages the settings offer, by English name. Any Google Translate code works too. */
export const languages: readonly Language[] = [
  { code: 'ar', name: 'Arabic' },
  { code: 'bg', name: 'Bulgarian' },
  { code: 'zh-CN', name: 'Chinese (Simplified)' },
  { code: 'zh-TW', name: 'Chinese (Traditional)' },
  { code: 'cs', name: 'Czech' },
  { code: 'da', name: 'Danish' },
  { code: 'nl', name: 'Dutch' },
  { code: 'en', name: 'English' },
  { code: 'fi', name: 'Finnish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'el', name: 'Greek' },
  { code: 'he', name: 'Hebrew' },
  { code: 'hi', name: 'Hindi' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'id', name: 'Indonesian' },
  { code: 'it', name: 'Italian' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'no', name: 'Norwegian' },
  { code: 'fa', name: 'Persian' },
  { code: 'pl', name: 'Polish' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ro', name: 'Romanian' },
  { code: 'ru', name: 'Russian' },
  { code: 'sr', name: 'Serbian' },
  { code: 'es', name: 'Spanish' },
  { code: 'sv', name: 'Swedish' },
  { code: 'th', name: 'Thai' },
  { code: 'tr', name: 'Turkish' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'vi', name: 'Vietnamese' },
];

/** The English name of the language with `code`, or the code itself if it isn't in the list. */
export function languageName(code: string): string {
  return languages.find((language) => language.code === code)?.name ?? code;
}

/** Whether two language codes name the same language, ignoring region ("zh-CN" vs "zh", "iw" vs "he"). */
export function sameLanguage(a: string, b: string): boolean {
  const base = (code: string) => {
    const primary = code.toLowerCase().split('-')[0] ?? '';
    return primary === 'iw' ? 'he' : primary;
  };
  return base(a) === base(b);
}
