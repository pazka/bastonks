import { assertEquals } from "@std/assert";
import { hasMaskable, MARK, mask, MASK_PATTERNS } from "../src/server/mask.ts";

const MASKED: [string, string][] = [
  ["écrire à salome.k@example.org demain", `écrire à ${MARK} demain`],
  ["contact: Jury.These@Univ-Exemple.fr.", `contact: ${MARK}.`],
  ["salome [at] example.org", MARK],
  ["appeler le 06 12 34 56 78", `appeler le ${MARK}`],
  ["tel 0612345678", `tel ${MARK}`],
  ["tél. 01.23.45.67.89 (labo)", `tél. ${MARK} (labo)`],
  ["+33 6 98 76 54 32", MARK],
  ["+33 (0)6 98 76 54 32", MARK],
  ["+44 20 7946 0958", MARK],
  ["patient 12", `patient ${MARK}`],
  ["Patient n°7 et patiente 3", `Patient ${MARK} et patiente ${MARK}`],
  ["patients #14", `patients ${MARK}`],
  ["patient12", `patient ${MARK}`],
  ["transcription 047_B ok", `transcription ${MARK} ok`],
  ["fichiers 112_AB, 047_B2", `fichiers ${MARK}, ${MARK}`],
  ["(047_b)", `(${MARK})`],
  ["voir https://trello.com/c/AbCdEf12/42-carte ici", `voir ${MARK} ici`],
  ["trello.com/b/xyz", MARK],
];

const KEPT = [
  "DONE 25/11/2024",
  "DONE 20/11/023",
  "18/08//2025",
  "réunion avec Marie, Thomas et Léa",
  "F1 = 0.71 sur 2023-2024",
  "chapitre 2, section 3.4",
  "rapport_2024_final.pdf",
  "lire Scherer 2005, p. 695-729",
  "les patients de l'étude",
  "https://example.org/article.pdf",
  "ISBN 978-2-07-036822-8",
];

Deno.test("mask: documented patterns are masked", () => {
  for (const [input, want] of MASKED) assertEquals(mask(input), want, input);
});

Deno.test("mask: ordinary text, dates and first names are kept", () => {
  for (const s of KEPT) assertEquals(mask(s), s, s);
});

Deno.test("mask: idempotent and leaves nothing maskable", () => {
  for (const [input] of MASKED) {
    assertEquals(mask(mask(input)), mask(input));
    assertEquals(hasMaskable(mask(input)), false, input);
    assertEquals(hasMaskable(input), true, input);
  }
});

Deno.test("mask: every pattern is documented", () => {
  for (const p of MASK_PATTERNS) {
    assertEquals(p.name.length > 0 && p.why.length > 10, true);
    assertEquals(p.re.global, true, `${p.name} must be global`);
  }
});
