import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'

/** Az ad hoc úton (`--dir`, `--file`) felvehető szöveges átiratok kiterjesztései. */
export const TEXT_EXTENSIONS = ['.txt', '.md'] as const

/** A véletlen óriásfájl elleni kapu; a költséget a becslés és a költségkeret védi. */
const MAX_BYTES = 2 * 1024 * 1024

/**
 * A vezető YAML-frontmatter levágása: `---` nyitó sor, `---` vagy `...` záró
 * sor. Záró sor nélkül nincs levágás — a `---` lehet vízszintes vonal is.
 */
export function stripFrontmatter(text: string): string {
  const lines = text.split('\n')
  if (lines[0] !== '---') return text
  const close = lines.findIndex((line, index) => index > 0 && (line === '---' || line === '...'))
  return close === -1 ? text : lines.slice(close + 1).join('\n')
}

/**
 * A vault lintje (`vault/lint.ts`) tiltja a wikilinket és a csúcsos zárójel
 * nélküli link-célt. A szöveges átirat ezért így megy tovább: a wikilinkből a
 * felirata (vagy a célja) marad, a link célja csúcsos zárójelbe kerül.
 */
export function vaultSafeLinks(text: string): string {
  return text
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, alias: string | undefined) =>
      alias ?? target,
    )
    .replace(/(!?\[[^\]]*\]\()([^)]*)\)/g, (match, open: string, dest: string) =>
      dest.startsWith('<') ? match : `${open}<${dest}>)`,
    )
}

/**
 * Egy `.txt`/`.md` átirat szövege, ellenőrizve és normalizálva: BOM nélkül (a
 * `TextDecoder` levágja), `\n` sorvégekkel, `.md`-nél frontmatter nélkül,
 * vault-biztos linkekkel, levágott szélekkel. Az azonosító ebből készül.
 */
export async function readTextSource(path: string): Promise<string> {
  const { size } = await stat(path)
  if (size > MAX_BYTES) {
    throw new Error(`a fájl túl nagy: ${(size / 1024 / 1024).toFixed(1)} MB, legfeljebb 2 MB`)
  }
  const bytes = await readFile(path)
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('a fájl nem UTF-8 szöveg')
  }
  if (text.includes('\0')) throw new Error('a fájl nem UTF-8 szöveg')

  text = text.replace(/\r\n?/g, '\n')
  if (path.toLowerCase().endsWith('.md')) text = stripFrontmatter(text)
  text = vaultSafeLinks(text).trim()
  if (text === '') throw new Error('a fájl üres')
  return text
}

/**
 * A szöveges tétel azonosítója a tartalomból: átnevezés, áthelyezés nem új
 * tétel, szerkesztés igen. A `t-` előtag választja el a videóazonosítótól.
 */
export function textItemId(text: string): string {
  return `t-${createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)}`
}
