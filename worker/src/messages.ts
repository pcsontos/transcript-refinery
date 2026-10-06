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

function flatTitle(title: string): string {
  return title.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/ {2,}/g, ' ').trim()
}

export function readyLine(title: string): string {
  return `${flatTitle(title)}. A felirat megvan.`
}

export function alreadyLine(videoId: string): string {
  return `Már sorban van: ${videoId}.`
}

export const MISSING_NOTE_URL = 'A jegyzet linkje hiányzik.'

export function noteReadyMessage(title: string, noteUrl: string): string {
  return `${flatTitle(title)}. A jegyzet megvan.\n${noteUrl}`
}

export function summaryButton(jobId: string): { text: 'summary'; data: string } {
  return { text: 'summary', data: `summary:${jobId}` }
}
