import { readFileSync } from 'node:fs'

/**
 * A jegyzetek frontmatterjébe írt eszközverzió. A `package.json`-ból jön,
 * mert a `bumpp` csak azt emeli; a `src/` és a `dist/` egyaránt egy szinttel
 * a gyökér alatt van, így a relatív út mindkettőből a gyökérre mutat.
 */
export const VERSION = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string
  }
).version

/**
 * Az app saját, vaultba írt commitjainak scope-ja. Az app neve, nem a
 * feldolgozott tartalomé: a `videos` egy korábbi, videó-központú fázisból
 * maradt itt.
 */
export const COMMIT_SCOPE = 'transcript-refinery'
