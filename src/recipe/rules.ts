import { languageName } from '../lang/identify.js'
import type { SourceItem } from '../types.js'

/**
 * A vault-invariáns prompt-szabályok. Minden recept ugyanezeket idézi: a
 * visszavezethetőség és a vault írási szabályai nem recept-függőek.
 *
 * A recept-specifikus szabályt (hossz, szerkezet) mindegyik recept maga fűzi
 * hozzá, a **saját sorrendjében** — ezért nevesített konstansok, nem kész
 * lista.
 *
 * Angolul, mert a promptba mennek.
 */
export const RULE = {
  traceable: [
    '- Every statement must be traceable to the transcript. Do not add outside',
    '  knowledge, and do not speculate about what the speaker meant.',
  ].join('\n'),

  noFrontmatter: '- Do not emit YAML frontmatter; it is added separately.',

  noWikilinks: [
    '- Do not use wikilinks (`[[...]]`). If you link, wrap the target in angle',
    '  brackets: `[Name](<https://example.com>)`.',
  ].join('\n'),
} as const

/**
 * A nyelvi szabály **elemenként változik**, ezért függvény, nem konstans.
 *
 * A nyelvet kimondjuk, nem az átiratra hivatkozunk. A korábbi
 * megfogalmazás — „write in the same language as the transcript" — nem
 * bizonyult elég erősnek: a modell a prompt `Channel:` sorából a beszélő
 * nevére, abból pedig kimeneti nyelvre következtetett, és felülírta a
 * szabályt (`0009`). A `Channel:` sor azóta nincs a promptban, de a
 * kimondott nyelv attól függetlenül erősebb utasítás.
 */
export function languageRule(item: SourceItem): string {
  return `- Write in ${languageName(item.language)}. Do not translate the transcript into another language.`
}
