const KIND_LABELS: Record<string, string> = {
  transcript: 'átirat',
  summary: 'összefoglaló',
  flashcards: 'tanulókártya',
  qa: 'kérdés-felelet',
}

/** A műtermék-típus magyar neve; ismeretlen típusnál maga az azonosító. */
export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind
}

const RUN_STATUS_LABELS: Record<string, string> = {
  running: 'fut',
  died: 'nyom nélkül leállt',
  interrupted: 'megszakítva',
  capped: 'a plafon miatt megállt',
  done: 'kész',
  failed: 'hibával ért véget',
  closed: 'lezárt',
  unknown: 'ismeretlen',
}

export function runStatusLabel(status: string): string {
  return RUN_STATUS_LABELS[status] ?? status
}

export function runStatusColor(status: string): 'info' | 'success' | 'warning' | 'error' | 'neutral' {
  switch (status) {
    case 'running':
      return 'info'
    case 'done':
      return 'success'
    case 'capped':
    case 'interrupted':
      return 'warning'
    case 'died':
    case 'failed':
      return 'error'
    default:
      return 'neutral'
  }
}

/** Négy tizedes, mint a CLI: egyetlen elem költsége két tizedessel mindig 0.00 lenne. */
export function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`
}

export function formatScore(value: number | null): string {
  return value === null ? '–' : value.toFixed(2)
}

/** Determinisztikus, UTC: a szerveren és a böngészőben ugyanaz a szöveg. */
export function formatDate(iso: string | null): string {
  return iso === null ? '–' : `${iso.slice(0, 19).replace('T', ' ')} UTC`
}

export function formatTime(iso: string): string {
  return iso.slice(11, 19)
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return '–'
  const seconds = Math.max(0, Math.round(ms / 1000))
  return seconds < 60 ? `${seconds} mp` : `${Math.floor(seconds / 60)} p ${seconds % 60} mp`
}

/** Egy naplósor mezői a típus és az idő nélkül, röviden — az idővonalhoz. */
export function lineDetail(line: object): string {
  const rest = Object.fromEntries(
    Object.entries(line).filter(([key]) => key !== 'type' && key !== 'at'),
  )
  const text = JSON.stringify(rest)
  return text.length > 160 ? `${text.slice(0, 159)}…` : text
}

/** A `useFetch` hibájából a szerver üzenete (az 500-as válasz `message` mezője). */
export function errorMessage(error: unknown): string {
  const body = (error as { data?: { message?: unknown } } | null)?.data
  if (typeof body?.message === 'string') return body.message
  return error instanceof Error ? error.message : 'Ismeretlen hiba.'
}
