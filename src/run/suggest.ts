/**
 * A futásspecifikus kapcsolók: a folytatási javaslatból ki kell esniük.
 *
 * A `--limit` azért, mert egy `run --limit 5` után a szó szerinti hívási sor
 * megint csak ötöt vinne el a hátralévőkből; a `--retry-failed` azért, mert a
 * javaslat maga dönti el, kell-e — és kétszer semmiképp nem kerülhet rá.
 */
const DROPPED_FLAGS = ['--limit', '--retry-failed']

/**
 * A javaslat alapja: a parancssor a futásspecifikus kapcsolók nélkül.
 *
 * Bináris-előtagot (`node dist/cli.js`, `pnpm`, `mise`) szándékosan NEM tesz
 * elé: a repó három hívási módot ismer, és a riport `Parancs:` sora is előtag
 * nélküli — a kettő maradjon egy alakú.
 */
export function suggestionBase(commandLine: string): string {
  const tokens = commandLine.split(/\s+/).filter((t) => t.length > 0)
  const out: string[] = []

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    // `--limit=5`: a kapcsoló és az értéke egyetlen szó.
    if (DROPPED_FLAGS.some((flag) => token.startsWith(`${flag}=`))) continue
    if (DROPPED_FLAGS.includes(token)) {
      // `--limit 5`: a következő szó az érték, az is kiesik. A `--retry-failed`
      // értéket nem vesz fel, ezért csak a `--limit`-nél lépünk egyet.
      if (token === '--limit') i++
      continue
    }
    out.push(token)
  }

  return out.join(' ')
}

/**
 * A riportban javasolt folytató parancs, vagy `undefined`, ha nincs mit
 * javasolni.
 *
 * A hátralévő elem erősebb a hibásnál: amíg van feldolgozatlan elem, a teljes
 * futás a következő lépés. Ha viszont a korpusz végigment, és csak hibás elem
 * maradt, akkor a `--retry-failed` az — pont ez a reggel-utáni eset.
 */
export function nextCommand(
  commandLine: string,
  corpus: { pending: number; failed: number },
): string | undefined {
  if (corpus.pending > 0) return suggestionBase(commandLine)
  if (corpus.failed > 0) return `${suggestionBase(commandLine)} --retry-failed`
  return undefined
}
