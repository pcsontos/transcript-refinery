import { createHash } from 'node:crypto'

/**
 * Egy elem azonosítója.
 *
 * A metaadatfájl videóazonosítója a kulcs, ha van — így a már feldolgozott
 * videók azonosítója nem változik. Ha nincs metaadat, a forrásnév és a
 * forráson belüli relatív **alapnév** párosából képzett hash áll a helyére.
 *
 * A nyelvi utótag és a kiterjesztés szándékosan nincs a hashben: egy
 * `.en.srt` → `.hu.vtt` csere ugyanazt az elemet jelenti, nem újat.
 *
 * Ismert következmény: ha egy elem mellé **utólag** kerül metaadatfájl, az
 * azonosító hashről videóazonosítóra vált, tehát az elem újra feldolgozódik.
 * Ez tudatos csere: a stabil, beszédes azonosítót többre tartjuk, mint az
 * egyszeri újrafuttatás elkerülését.
 */
export function itemIdFor(source: string, relBase: string, videoId?: string): string {
  if (videoId) return videoId
  return createHash('sha256').update(`${source}/${relBase}`, 'utf8').digest('hex').slice(0, 16)
}
