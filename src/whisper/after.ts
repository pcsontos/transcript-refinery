import type { Config } from '../config.js'

/** Az inbox-`info.json` jelölője (pcsontos/issue-tracker#45): a leadó Telegram-munka `jobId`-je, vagy `cli`. */
export const AFTER_FIELD = 'refinery_after'
export const CLI_AFTER = 'cli'

/** A leadáskor írandó jelölő: csak ha a configban van utólépés, így a régi és az `after` nélkül leadott átiratok nem indítanak semmit. */
export function afterMarker(cfg: Pick<Config, 'whisperAfter'>, origin: string): string | undefined {
  return cfg.whisperAfter === null ? undefined : origin
}
