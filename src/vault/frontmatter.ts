export type FrontmatterValue = string | number | readonly string[]

/** Egy mező: név és érték. Az `undefined` érték kimarad a kimenetből. */
export type FrontmatterField = readonly [name: string, value: FrontmatterValue | undefined]

/**
 * Idézőjel nélkül biztonságos alak. Szűk szándékosan: a `:` és a `#` YAML-ban
 * jelentést hordoz, ezért az ilyen érték idézőjelet kap.
 *
 * `\p{L}` és `\p{N}` — nem `\w` —, mert a `\w` a `u` jelölő mellett is csak
 * ASCII-betűket fed le, az ékezetes (pl. magyar) betűket idézőjelezné. A `/`
 * a relatív útvonalak (pl. `source_file`) miatt szerepel: önmagában nem
 * YAML-jelentésű, csak `:` vagy `#` mellett válna azzá, azok viszont nincsenek
 * a halmazban.
 */
const PLAIN = /^[\p{L}\p{N}_ ./@-]+$/u

/**
 * Kizáró feltételek, amik a `PLAIN` teszttől függetlenül idézőjelet
 * kényszerítenek — a `PLAIN` karakterhalmaza önmagában nem zárja ki ezeket,
 * pedig idézés nélkül vagy törik a YAML-t, vagy csendben más típust adnak.
 */

/**
 * Egész szám alakú érték. Idézés nélkül a beolvasáskor számmá válna, holott
 * a mező (pl. `channel`, `tags` eleme) szövegként értendő. Szándékosan csak
 * egész szám: a `score`/`cost_usd`/`punctuation_density` mezők tizedesponttal
 * formázott, valódi számot hordozó szövegek — ezeknél a számmá válás a helyes
 * viselkedés, nem hibás típusváltás.
 */
const INTEGER = /^[+-]?\d+$/

/**
 * YAML-ban logikai vagy null értékként olvasható szó, kis-nagybetűtől
 * függetlenül. A `true`/`false`/`null`/`~` YAML 1.2-ben is így viselkedik; a
 * `yes`/`no`/`on`/`off` YAML 1.1-es alak, amit egyes elemzők (pl. az
 * Obsidianban futó) még értelmeznek.
 */
const RESERVED_WORD = /^(?:true|false|null|yes|no|on|off|~)$/i

function needsQuoting(value: string): boolean {
  if (value !== value.trim()) return true
  if (/^[-@]/.test(value)) return true
  if (INTEGER.test(value)) return true
  if (RESERVED_WORD.test(value)) return true
  return false
}

function scalar(value: string): string {
  if (value === '') return '""'
  if (PLAIN.test(value) && !needsQuoting(value)) return value
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * Blokk-skalár a többsoros értékekhez. A `|-` a záró sortörést levágja, így a
 * mező értéke pontosan az, ami a forrásban volt.
 *
 * A behúzásjelző EXPLICIT (`|2-`), nem hallgatólagos: YAML-ban a blokk
 * behúzását — jelző híján — az első nem üres sor adja meg. Ha az érték maga
 * is behúzottan kezdődik (pl. egy videó-leírás `"   Támogasd a csatornát!"`
 * sorral indul), a kevésbé behúzott következő sor a `|-` alakkal érvénytelen
 * YAML-t eredményezne — a `2` explicit jelzővel az érték saját behúzása nem
 * keveredik a blokk behúzásával.
 */
function block(name: string, value: string): string {
  const lines = value.split('\n').map((line) => (line === '' ? '' : `  ${line}`))
  return [`${name}: |2-`, ...lines].join('\n')
}

/**
 * Mezőlista → YAML-frontmatter.
 *
 * A hiányzó mező **kimarad**, nem `null` értékkel szerepel: a `channel: null`
 * azt állítaná, hogy tudjuk, nincs csatorna, holott csak nem volt metaadat.
 * A különbség a későbbi mérésben számít.
 */
export function renderFrontmatter(fields: readonly FrontmatterField[]): string {
  const lines: string[] = ['---']

  for (const [name, value] of fields) {
    if (value === undefined) continue

    if (typeof value === 'number') {
      lines.push(`${name}: ${String(value)}`)
      continue
    }

    if (typeof value !== 'string') {
      lines.push(`${name}: [${value.map(scalar).join(', ')}]`)
      continue
    }

    const text = value.replace(/\r\n/g, '\n').replace(/\n+$/, '')
    lines.push(text.includes('\n') ? block(name, text) : `${name}: ${scalar(text)}`)
  }

  lines.push('---')
  return lines.join('\n')
}
