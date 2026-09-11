import type { RunSummary } from '../events.js'
import type { CorpusStatus } from '../state/db.js'

export interface ReportCost {
  spentUsd: number
  limitUsd: number
  /** A futás azért állt meg, mert elérte a plafont. */
  capped: boolean
}

/** Egy műtermék-típus korpusz-állapota. */
export interface KindCorpus {
  kind: string
  status: CorpusStatus
}

/** A queue-futás kiválasztott párjainak állapota, egy receptre. */
export interface QueueRecipeStatus {
  recipe: string
  /** A kipipált, a szűrőkön átjutott párok — a nem található elemekkel együtt. */
  selected: number
  done: number
  /** Hibás, vagy a felirat nem található. */
  failed: number
  pending: number
  /** A plafon miatt a következő futásra maradt. */
  deferred: number
}

export interface ReportInput {
  runId: string
  startedAt: Date
  finishedAt: Date
  /** A futást indító parancs, kapcsolókkal — a riport reprodukálhatósága. */
  command: string
  summary: RunSummary
  /** A futás minden érintett műtermék-típusának korpusz-állapota, sorrendben. */
  corpora: KindCorpus[]
  /** Csak queue-futásnál: a kipipált párok állapota receptenként. */
  queue?: QueueRecipeStatus[]
  /** Nem végzetes, de jelzendő tények — például ismeretlen recept a sorban. */
  warnings?: string[]
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

/** Egy sorba fésült szöveg: az újsorok és a kocsivissza helyén szóköz áll. */
function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ')
}

/** Markdown táblázatcella-értékek biztonságossá tétele: újsorok → szóköz, | → \| */
function escapeTableCell(value: string): string {
  return oneLine(value).replace(/\|/g, '\\|') // Pipe → escaped pipe
}

/**
 * A futás riportja Markdownban. Tiszta függvény: nem ír fájlt és nem olvas
 * órát — így a tesztje a szövegről szól, nem a környezetről.
 */
export function renderReport(input: ReportInput): string {
  const { summary, corpora, queue } = input
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
    // Felsorolás, nem vessző-lista: a név a lényeg, az azonosító csak azért
    // marad mellette, hogy a naplóval és az állapottárral összeköthető legyen.
    lines.push(`Automatikus feliratból készült (${String(summary.autoItems.length)}):`)
    lines.push('')
    for (const item of summary.autoItems) {
      lines.push(`- ${oneLine(item.title)} (\`${item.itemId}\`)`)
    }
    lines.push('')
  }

  if (input.warnings && input.warnings.length > 0) {
    lines.push('## Figyelmeztetések')
    lines.push('')
    for (const warning of input.warnings) lines.push(`- ${oneLine(warning)}`)
    lines.push('')
  }

  if (summary.failures.length > 0) {
    lines.push('## Hibák')
    lines.push('')
    lines.push('| elem | típus | forrás | ok |')
    lines.push('|---|---|---|---|')
    for (const failure of summary.failures) {
      lines.push(
        `| \`${failure.itemId}\` | ${escapeTableCell(failure.kind)} | ` +
          `${escapeTableCell(failure.source)} | ${escapeTableCell(failure.error)} |`,
      )
    }
    lines.push('')
  }

  if (queue) {
    lines.push('## A sor állapota')
    lines.push('')
    lines.push('| recept | kipipálva | kész | hibás | hátra | plafon miatt maradt |')
    lines.push('|---|---|---|---|---|---|')
    for (const q of queue) {
      lines.push(
        `| ${escapeTableCell(q.recipe)} | ${String(q.selected)} | ${String(q.done)} | ` +
          `${String(q.failed)} | ${String(q.pending)} | ${String(q.deferred)} |`,
      )
    }
    lines.push('')
  }

  for (const { kind, status } of corpora) {
    lines.push(`## A korpusz állapota — ${oneLine(kind)}`)
    lines.push('')
    lines.push('| forrás | összes | kész | hibás | hátra |')
    lines.push('|---|---|---|---|---|')
    for (const s of status.bySource) {
      lines.push(
        `| ${escapeTableCell(s.source)} | ${String(s.total)} | ${String(s.done)} | ` +
          `${String(s.failed)} | ${String(s.pending)} |`,
      )
    }
    lines.push('')
  }

  // A felirat-forrás bontása és az összköltség típustól független: egyszer
  // írjuk ki, az első típus állapotából.
  const first = corpora[0]?.status
  if (first) {
    lines.push(
      `Kreátori ${String(first.byCaptionSource.creator)} / ` +
        `automatikus ${String(first.byCaptionSource.auto)} · ` +
        `${String(input.runs)} futás naplója · ` +
        `összköltség: ${first.totalCostUsd.toFixed(2)} $`,
    )
    lines.push('')
  }

  lines.push('## Következő lépés')
  lines.push('')
  if (queue) {
    // Queue-futásnál a teljes korpusz hátralévő elemei félrevezetnének: a
    // kérdés az, hogy a kipipált párokból mi maradt.
    const pending = queue.reduce((n, q) => n + q.pending + q.deferred, 0)
    const failed = queue.reduce((n, q) => n + q.failed, 0)
    if (pending > 0) {
      lines.push(`${String(pending)} pár hátravan.`)
      if (input.nextCommand) lines.push(`Folytatás: \`${input.nextCommand}\``)
    } else if (failed > 0) {
      lines.push('A sor feldolgozva, de maradtak hibás párok.')
      if (input.nextCommand) lines.push(`Újrapróbálás: \`${input.nextCommand}\``)
    } else {
      lines.push('A sor feldolgozva.')
    }
  } else if (first && first.pending > 0) {
    lines.push(`${String(first.pending)} elem hátravan.`)
    if (input.nextCommand) lines.push(`Folytatás: \`${input.nextCommand}\``)
  } else if (first && first.failed > 0) {
    lines.push('A korpusz feldolgozva, de maradtak hibás elemek.')
    if (input.nextCommand) lines.push(`Újrapróbálás: \`${input.nextCommand}\``)
  } else {
    lines.push('A korpusz feldolgozva.')
  }
  lines.push('')

  return lines.join('\n')
}
