export const REJECTED_SECRET = 'A konténer elutasította a hívást.'

export const PLAYLIST_LINE = 'Lejátszási lista későbbre marad.'
export const NOT_YOUTUBE_LINE = 'Nem YouTube-cím.'
export const NO_VIDEO_LINE = 'Nincs YouTube-videó az üzenetben.'

export function queuedLine(videoId: string): string {
  return `Sorba került: ${videoId}`
}

export function waitingLine(videoId: string): string {
  return `A gép ébredésére vár: ${videoId}.`
}

export function readyLine(title: string): string {
  return `${title}. A felirat megvan.`
}

export function alreadyLine(videoId: string): string {
  return `Már sorban van: ${videoId}.`
}
