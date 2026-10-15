/**
 * A szöveges átirat Node-mentes magja. A CLI (`./text.js`) és a Worker
 * (`transcript-refinery/text`) ugyanezt hívja, így a `t-…` azonosító mindkét
 * oldalon ugyanaz. Ide Node-modul nem importálható: a Worker bundle-je betölti.
 */

/** Az ad hoc úton (`--dir`, `--file`) és Telegramból felvehető szöveges átiratok kiterjesztései. */
export const TEXT_EXTENSIONS = ['.txt', '.md'] as const

export const SUBTITLE_EXTENSIONS = ['.srt', '.vtt'] as const

/** A véletlen óriásfájl elleni kapu; a költséget a becslés és a költségkeret védi. */
export const MAX_TEXT_BYTES = 2 * 1024 * 1024

export function tooLargeMessage(bytes: number): string {
  return `a fájl túl nagy: ${(bytes / 1024 / 1024).toFixed(1)} MB, legfeljebb 2 MB`
}

/**
 * Nyelvkódnak látszó utótag: `en`, `hu`, `en-US`. A szűkítés szándékos — a
 * `Some.Talk.srt` alapneve `Some.Talk` marad, nem `Some`.
 *
 * A nyelvrész (kötőjel előtti szakasz) KIZÁRÓLAG kisbetűs lehet — a
 * régiókód (kötőjel utáni szakasz) case-insensitive marad, mert a
 * yt-dlp/whisper `en-US` alakja is nagybetűs régiót ad. A megszorítás a
 * `Rész.II.srt` / `Rész.III.srt` osztályt üti ki: a római szám nagybetűs,
 * tehát levágás nélkül marad az alapnév része.
 *
 * Két ismert korlát, mindkettő tudatosan vállalt:
 * 1. A kézzel írt NAGYBETŰS nyelvkód (`Talk.EN.srt`) nem ismerődik fel — a
 *    yt-dlp és a whisper is kisbetűset ad, a megkülönböztetés a római
 *    számoktól viszont enélkül nem megoldható.
 * 2. A címvégi kisbetűs kétbetűs szótag (`Bevezetés a Node.js.srt`) alakilag
 *    azonos egy valódi nyelvkóddal, ezért levágódik: az alapnév csonka lesz
 *    és a `language` hamis. A metaadat viszont NEM vész el — a
 *    sidecar-keresés a levágás nélküli nevet is próbálja.
 */
const LANGUAGE_TAG = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/

export interface SubtitleName {
  base: string
  language: string | null
}

/**
 * `Beszéd.en.srt` → `{ base: 'Beszéd', language: 'en' }`. Nem feliratfájlra
 * `null`. Az alapnév a metaadatfájl megtalálásának és az elem
 * azonosításának is az alapja, ezért a levágás szabályai szűkek.
 */
export function splitSubtitleName(
  fileName: string,
  extensions: readonly string[] = SUBTITLE_EXTENSIONS,
): SubtitleName | null {
  const lower = fileName.toLowerCase()
  const ext = extensions.find((candidate) => lower.endsWith(candidate))
  if (!ext) return null

  const withoutExt = fileName.slice(0, -ext.length)
  const dot = withoutExt.lastIndexOf('.')
  if (dot > 0) {
    const tag = withoutExt.slice(dot + 1)
    if (LANGUAGE_TAG.test(tag)) {
      return { base: withoutExt.slice(0, dot), language: tag }
    }
  }
  return { base: withoutExt, language: null }
}

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
    .replace(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_match, target: string, alias: string | undefined) =>
      alias === undefined || alias === '' ? target : alias,
    )
    .replace(/(!?\[[^\]]*\]\()((?:[^()]|\([^()]*\))*)\)/g, (match, open: string, dest: string) => {
      if (dest.startsWith('<')) return match
      // A vault lintje a `(<cél> "cím")` alakot sem fogadja el, ezért a link címe elmarad.
      const titled = /^(.*?)\s+("[^"]*"|'[^']*')$/s.exec(dest)
      return `${open}<${titled ? titled[1]! : dest}>)`
    })
}

/**
 * Egy `.txt`/`.md` átirat szövege a bájtokból, ellenőrizve és normalizálva: BOM
 * nélkül (a `TextDecoder` levágja), `\n` sorvégekkel, `.md`-nél frontmatter
 * nélkül, vault-biztos linkekkel, levágott szélekkel. Az azonosító ebből készül.
 * A már normalizált szövegen (`markdown: false`) hatástalan.
 */
export function normalizeText(bytes: Uint8Array, markdown: boolean): string {
  if (bytes.byteLength > MAX_TEXT_BYTES) throw new Error(tooLargeMessage(bytes.byteLength))
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('a fájl nem UTF-8 szöveg')
  }
  if (text.includes('\0')) throw new Error('a fájl nem UTF-8 szöveg')

  text = text.replace(/\r\n?/g, '\n')
  if (markdown) text = stripFrontmatter(text)
  text = vaultSafeLinks(text).trim()
  if (text === '') throw new Error('a fájl üres')
  return text
}

/**
 * A szöveges tétel azonosítója a tartalomból: átnevezés, áthelyezés nem új
 * tétel, szerkesztés igen. A `t-` előtag választja el a videóazonosítótól.
 * Web Crypto, hogy a Workerben is fusson; az érték a korábbi `node:crypto`-s.
 */
export async function textItemId(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `t-${hex.slice(0, 16)}`
}

const TEXT_ITEM_ID = /^t-[0-9a-f]{16}$/

/** A YouTube-azonosító 11 karakter, és kezdődhet `t-`-vel; a szöveges tételé mindig 18. */
export function isTextItemId(id: string): boolean {
  return TEXT_ITEM_ID.test(id)
}
