import type { RunSummary } from '../events.js'
import type { CorpusStatus } from '../state/db.js'

export interface ReportCost {
  spentUsd: number
  limitUsd: number
  /** A futás azért állt meg, mert elérte a plafont. */
  capped: boolean
}

export interface ReportInput {
  runId: string
  startedAt: Date
  finishedAt: Date
  /** A futást indító parancs, kapcsolókkal — a riport reprodukálhatósága. */
  command: string
  summary: RunSummary
  corpus: CorpusStatus
  /** Ennyi futás naplója van a naplómappában, ezt is beleértve. */
  runs: number
  logPath: string
  cost?: ReportCost
  /** A folytatáshoz javasolt parancs; hátralévő elem nélkül hiányzik. */
  nextCommand?: string
}

/** `2026-09-07 02:14` — a riport fejlécének olvasható időpontja. */
function stamp(date: Date): string {
  return date.toISOString().slice(0, 16).replace('T', ' ')
}

/** Markdown táblázatcella-értékek biztonságossá tétele: újsorok → szóköz, | → \| */
function escapeTableCell(value: string): string {
  return value
    .replace(/[\r\n]+/g, ' ') // Újsorok és kocsivissza → szóköz
    .replace(/\|/g, '\\|') // Pipe → escaped pipe
}

/**
 * A futás riportja Markdownban. Tiszta függvény: nem ír fájlt és nem olvas
 * órát — így a tesztje a szövegről szól, nem a környezetről.
 */
export function renderReport(input: ReportInput): string {
  const { summary, corpus } = input
  const lines: string[] = []

  lines.push(`# Futás — ${stamp(input.startedAt)} → ${stamp(input.finishedAt)}`)
  lines.push('')
  lines.push(`Parancs: \`${input.command}\``)
  lines.push(`Futásazonosító: \`${input.runId}\``)
  if (input.cost) {
    const { spentUsd, limitUsd, capped } = input.cost
    const suffix = capped ? ' — plafon elérve' : ''
    lines.push(`Költés: ${spentUsd.toFixed(2)} $ / ${limitUsd.toFixed(2)} $${suffix}`)
  }
  lines.push(`Napló: \`${input.logPath}\``)
  lines.push('')

  lines.push('## Ez a futás')
  lines.push('')
  lines.push('| | |')
  lines.push('|---|---|')
  lines.push(
    `| sikeres | ${String(summary.succeeded)} ` +
      `(kreátori ${String(summary.byCaptionSource.creator)} / ` +
      `automatikus ${String(summary.byCaptionSource.auto)}) |`,
  )
  lines.push(`| kihagyva | ${String(summary.skipped)} |`)
  lines.push(`| hibás | ${String(summary.failed)} |`)
  lines.push('')

  if (summary.autoItems.length > 0) {
    lines.push(
      `Automatikus feliratból készült (${String(summary.autoItems.length)}): ` +
        summary.autoItems.map((id) => `\`${id}\``).join(', '),
    )
    lines.push('')
  }

  if (summary.failures.length > 0) {
    lines.push('## Hibák')
    lines.push('')
    lines.push('| elem | ok |')
    lines.push('|---|---|')
    for (const failure of summary.failures) {
      lines.push(`| \`${failure.itemId}\` | ${escapeTableCell(failure.error)} |`)
    }
    lines.push('')
  }

  lines.push('## A korpusz állapota')
  lines.push('')
  lines.push('| forrás | összes | kész | hibás | hátra |')
  lines.push('|---|---|---|---|---|')
  for (const s of corpus.bySource) {
    lines.push(
      `| ${escapeTableCell(s.source)} | ${String(s.total)} | ${String(s.done)} | ` +
        `${String(s.failed)} | ${String(s.pending)} |`,
    )
  }
  lines.push('')
  lines.push(
    `Kreátori ${String(corpus.byCaptionSource.creator)} / ` +
      `automatikus ${String(corpus.byCaptionSource.auto)} · ` +
      `${String(input.runs)} futás naplója · ` +
      `összköltség: ${corpus.totalCostUsd.toFixed(2)} $`,
  )
  lines.push('')

  lines.push('## Következő lépés')
  lines.push('')
  if (corpus.pending > 0) {
    lines.push(`${String(corpus.pending)} elem hátravan.`)
    if (input.nextCommand) lines.push(`Folytatás: \`${input.nextCommand}\``)
  } else if (corpus.failed > 0) {
    lines.push('A korpusz feldolgozva, de maradtak hibás elemek.')
    if (input.nextCommand) lines.push(`Újrapróbálás: \`${input.nextCommand}\``)
  } else {
    lines.push('A korpusz feldolgozva.')
  }
  lines.push('')

  return lines.join('\n')
}
