/**
 * A vault-invariáns prompt-szabályok. Minden recept ugyanezeket idézi: a
 * jegyzet nyelve, a visszavezethetőség és a vault írási szabályai nem
 * recept-függőek.
 *
 * A recept-specifikus szabályt (hossz, szerkezet) mindegyik recept maga fűzi
 * hozzá, a **saját sorrendjében** — ezért nevesített konstansok, nem kész
 * lista: a `summary` például a szerkezeti szabályát a lista közepére szúrja.
 *
 * Angolul, mert a promptba mennek.
 */
export const RULE = {
  language: '- Write in the same language as the transcript. Do not translate.',

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
