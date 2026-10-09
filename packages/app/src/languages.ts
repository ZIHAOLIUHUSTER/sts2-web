/** Only shipped languages; unsupported saved/device preferences safely use English. */
export const SUPPORTED_LANGUAGES = ['eng', 'zhs'] as const;
export function normalizeLanguage(lang: string | null | undefined): 'eng' | 'zhs' {
  return lang === 'zhs' || /^zh(?:[-_]|$)/i.test(lang ?? '') ? 'zhs' : 'eng';
}
