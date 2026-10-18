// Masking of personal details, applied server-side to every text field before anything is stored or sent.
// The list below is the documented contract (also in DEPLOY.md §5); each entry has tests in tests/mask_test.ts.
// First names of people are NOT masked (owner decision).

export const MARK = "•••";

export interface MaskPattern {
  name: string;
  why: string;
  re: RegExp;
  /** Replacement; `$<keep>` keeps a named group (e.g. the word "patient"). */
  replace: string;
}

export const MASK_PATTERNS: readonly MaskPattern[] = [
  {
    name: "trello-link",
    why: "any Trello URL or host (links between cards would reveal the board): never sent to the browser",
    re: /(?:https?:\/\/)?(?:[\w-]+\.)*trello\.com\b[^\s)\]>"'<]*/gi,
    replace: MARK,
  },
  {
    name: "email",
    why: "e-mail addresses (also obfuscated `name [at] host.tld` forms)",
    re: /[\p{L}\p{N}._%+-]+\s*(?:@|\[at\]|\(at\))\s*[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.[A-Za-z]{2,}/giu,
    replace: MARK,
  },
  {
    name: "phone-intl",
    why: "international numbers: + then 8 to 14 digits, with optional spaces, dots, dashes or (0)",
    re: /\+\s?\d{1,3}(?:[\s.\-]?\(0\))?(?:[\s.\-]?\d){7,13}(?![\p{L}\p{N}])/gu,
    replace: MARK,
  },
  {
    name: "phone-fr",
    why: "French national numbers: 0X XX XX XX XX (10 digits, optional separators)",
    re: /(?<![\p{L}\p{N}/])0[1-9](?:[\s.\-]?\d{2}){4}(?![\p{L}\p{N}/])/gu,
    replace: MARK,
  },
  {
    name: "patient-number",
    why: "the word patient(e)(s) followed by a number (n°, no, #, num, - optional): the number is masked",
    re:
      /(?<keep>\bpatient(?:e|s|es)?)(?:\s*(?:n°|nº|no\.?|num(?:éro|ero)?\.?|#|-|:))?\s*\d+(?:[A-Za-z](?!\p{L}))?/giu,
    replace: `$<keep> ${MARK}`,
  },
  {
    name: "transcript-code",
    why: "transcript codes like 047_B, 12_AB, 047_B2 (2–4 digits, underscore, 1–3 letters, 0–2 digits)",
    re: /(?<![\p{L}\p{N}])\d{2,4}_[A-Za-z]{1,3}\d{0,2}(?![\p{L}\p{N}])/gu,
    replace: MARK,
  },
];

/** Masks every documented pattern in `text`. Pure and idempotent. */
export function mask(text: string): string {
  let out = text;
  for (const p of MASK_PATTERNS) out = out.replace(p.re, p.replace);
  return out;
}

/** True if `text` still contains something a pattern would mask (used by the capability smoke). */
export function hasMaskable(text: string): boolean {
  return MASK_PATTERNS.some((p) => {
    p.re.lastIndex = 0;
    const m = p.re.test(text);
    p.re.lastIndex = 0;
    return m;
  });
}
