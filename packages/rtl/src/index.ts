import { splitFrontmatter } from '@knowledge-studio/markdown';

/** Persian/RTL presentation helpers. They never mutate note source content. */
export type TextDirection = 'ltr' | 'rtl' | 'auto';

const RTL_SAMPLE = /[\u0590-\u08ff]/u;
const LTR_SAMPLE = /[A-Za-z\u0370-\u03ff]/u;

export function detectDirection(text: string): TextDirection {
  const rtl = RTL_SAMPLE.test(text); const ltr = LTR_SAMPLE.test(text);
  if (rtl && ltr) return 'auto';
  if (rtl) return 'rtl';
  if (ltr) return 'ltr';
  return 'auto';
}

export interface DirectionSegment { readonly text: string; readonly direction: TextDirection; }

/** Splits fenced code blocks as LTR while leaving prose auto/RTL. */
export function segmentDirections(markdown: string): readonly DirectionSegment[] {
  const lines = markdown.split(/\r?\n/); const segments: DirectionSegment[] = []; let buffer: string[] = []; let inCode = false;
  const flush = (): void => { if (buffer.length === 0) return; const text = buffer.join('\n'); segments.push({ text, direction: inCode ? 'ltr' : detectDirection(text) }); buffer = []; };
  for (const line of lines) {
    if (/^\s*```/.test(line)) { flush(); inCode = !inCode; buffer.push(line); continue; }
    buffer.push(line);
  }
  flush(); return segments;
}

export interface NotePresentation { readonly direction: TextDirection; readonly codeDirection: 'ltr'; readonly body: string; readonly hasFrontmatter: boolean; }

export function presentationForNote(content: string): NotePresentation {
  const split = splitFrontmatter(content);
  return { direction: detectDirection(split.body), codeDirection: 'ltr', body: split.body, hasFrontmatter: split.frontmatter !== null };
}

/** Locale strings architecture; Persian is available without changing source files. */
export const LOCALES = {
  en: { code: 'en', name: 'English', direction: 'ltr' as const },
  fa: { code: 'fa', name: 'فارسی', direction: 'rtl' as const },
} as const;

export type LocaleCode = keyof typeof LOCALES;
