import { lintVaultMarkdown } from '../vault/lint.js'
import type { Criterion, Score } from './types.js'

const FENCE = /^```/gm
const WIKILINK = /\[\[[^\]]+\]\]/

/**
 * Determinisztikus formátum-ellenőrzés: sima függvény, nulla token.
 *
 * Ez szűri ki a hibák jelentős részét, **mielőtt bármi drága elindulna**, és
 * a futásidejű optimalizáló loopban is ez ad először visszajelzést
 * (`evaluation.md` §2).
 *
 * A hiányüzenetek angolul vannak, mert visszamennek a modellnek a javító
 * promptban — a jegyzet nyelvén kell szólniuk.
 */
export function checkFormat(output: string): Score {
  const gaps: string[] = []
  const trimmed = output.trim()

  if (trimmed === '') {
    gaps.push('The note is empty.')
  }

  if (WIKILINK.test(output)) {
    gaps.push(
      'Wikilinks are forbidden in this vault. Remove every [[...]] link or write it as [Name](<./path.md>).',
    )
  }

  // A linkcél-szabály egyetlen implementációja a Fázis 0 lintere; itt csak
  // a modellnek szóló megfogalmazás készül hozzá.
  const linkErrors = lintVaultMarkdown(output).filter((e) => !e.startsWith('wikilink'))
  if (linkErrors.length > 0) {
    gaps.push(
      `Every Markdown link target must be wrapped in angle brackets, e.g. [Name](<https://example.com>). ${String(linkErrors.length)} link(s) break this.`,
    )
  }

  if ((output.match(FENCE)?.length ?? 0) % 2 !== 0) {
    gaps.push('There is an unclosed code fence: every ``` must be paired.')
  }

  if (trimmed.startsWith('---')) {
    gaps.push(
      'Do not emit YAML frontmatter. It is added separately, and a second block would corrupt the note.',
    )
  }

  return { value: gaps.length === 0 ? 1 : 0, gaps }
}

/**
 * Kapu-kritérium: bukása esetén a bíró-hívások el sem indulnak.
 */
export const formatCriterion: Criterion = {
  name: 'format',
  blocking: true,
  score: (ctx) => Promise.resolve(checkFormat(ctx.output)),
}
