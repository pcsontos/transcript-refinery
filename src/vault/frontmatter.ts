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

function scalar(value: string): string {
  if (value === '') return '""'
  if (PLAIN.test(value)) return value
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * Blokk-skalár a többsoros értékekhez. A `|-` a záró sortörést levágja, így a
 * mező értéke pontosan az, ami a forrásban volt.
 */
function block(name: string, value: string): string {
  const lines = value.split('\n').map((line) => (line === '' ? '' : `  ${line}`))
  return [`${name}: |-`, ...lines].join('\n')
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
