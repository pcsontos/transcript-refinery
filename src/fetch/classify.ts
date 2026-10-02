const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const LIST_ID = /^[A-Za-z0-9_-]+$/

export interface VideoInput {
  kind: 'video'
  id: string
  url: string
}

export interface PlaylistInput {
  kind: 'playlist'
  id: string
  url: string
}

export interface RejectedInput {
  kind: 'rejected'
  raw: string
}

export type ClassifiedInput = VideoInput | PlaylistInput | RejectedInput

function rejected(raw: string): RejectedInput {
  return { kind: 'rejected', raw }
}

function video(id: string): VideoInput {
  return { kind: 'video', id, url: `https://www.youtube.com/watch?v=${id}` }
}

function isYouTubeHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, '')
  return host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be' || host === 'youtube-nocookie.com'
}

function pathId(pathname: string, marker: string): string | null {
  const parts = pathname.split('/').filter((part) => part !== '')
  const at = parts.indexOf(marker)
  const id = at === -1 ? undefined : parts[at + 1]
  return id !== undefined && VIDEO_ID.test(id) ? id : null
}

/** Egy trimelt sorból videó, lista vagy elutasítás. A videó URL-je kanonikus. */
export function classifyInput(raw: string, yesPlaylist: boolean): ClassifiedInput {
  const text = raw.trim()
  if (VIDEO_ID.test(text)) return video(text)
  let parsed: URL
  try {
    parsed = new URL(text)
  } catch {
    return rejected(text)
  }
  if (!isYouTubeHost(parsed.hostname)) return rejected(text)
  const list = parsed.searchParams.get('list')
  const watch = parsed.searchParams.get('v')
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
  const bare = host === 'youtu.be' ? parsed.pathname.split('/').filter((part) => part !== '')[0] : undefined
  const id =
    (watch !== null && VIDEO_ID.test(watch) ? watch : null) ??
    (bare !== undefined && VIDEO_ID.test(bare) ? bare : null) ??
    pathId(parsed.pathname, 'shorts') ??
    pathId(parsed.pathname, 'embed') ??
    pathId(parsed.pathname, 'live') ??
    pathId(parsed.pathname, 'v')
  const playlist = list !== null && LIST_ID.test(list)
  const playlistPath = parsed.pathname === '/playlist' || parsed.pathname.endsWith('/playlist')
  if (playlist && (yesPlaylist || id === null || playlistPath)) {
    return { kind: 'playlist', id: list, url: text }
  }
  if (id !== null) return video(id)
  return rejected(text)
}
