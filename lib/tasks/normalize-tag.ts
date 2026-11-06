import "server-only";
import folding from "./case-fold-15.1.json";
import { text } from "./validation";
// Unicode 15.1.0 CaseFolding.txt, common and full entries only (C and F).
// Source: https://www.unicode.org/Public/15.1.0/ucd/CaseFolding.txt
// Unicode data license: https://www.unicode.org/license.txt
const mapping: Record<string, string> = folding;
export function normalizeTag(value: unknown) {
  const name = text(value, 50, "name");
  const normalizedName = [...name.normalize("NFKC")]
    .map((c) => mapping[String(c.codePointAt(0))] ?? c)
    .join("")
    .normalize("NFKC");
  return { name, normalizedName };
}
