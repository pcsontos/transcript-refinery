/**
 * A publikus mérőréteg: **kézzel írt, szintetikus** felirat-fixture-ök.
 *
 * Nem a valós korpusz darabjai. Húsz idegen felirat becommitolása egy
 * publikus repóba szó szerinti újraközlés lenne (`evaluation.md` §4); ezek
 * viszont a valós **alakzatokat** utánozzák: háromszorozott sorok, írásjel
 * nélküli ASR-szöveg, strukturált tartalom.
 */
export interface Fixture {
  id: string
  title: string
  channel: string
  /** Nyers SRT, a gördülő ablakos ismétléssel együtt. */
  srt: string
  /** A fixture-modell által generálási körönként visszaadott jegyzetek. */
  notes: string[]
  /**
   * A bíró rögzített ítéletei, **hívási sorrendben**. Generálásonként kettő
   * kell: előbb a hűség, aztán a lefedettség.
   */
  verdicts: { score: number; gaps: string[] }[]
}

/** Gördülő ablakos ismétlés: minden sor háromszor, ahogy a YouTube adja. */
function rolling(lines: string[]): string {
  const blocks: string[] = []
  let n = 1
  for (let i = 0; i < lines.length; i++) {
    for (let repeat = 0; repeat < 3; repeat++) {
      const start = `00:00:${String(i * 3 + repeat).padStart(2, '0')},000`
      const end = `00:00:${String(i * 3 + repeat + 1).padStart(2, '0')},000`
      blocks.push(`${String(n)}\n${start} --> ${end}\n${lines[i]!}\n`)
      n++
    }
  }
  return blocks.join('\n')
}

export const PUBLIC_FIXTURES: Fixture[] = [
  {
    id: 'szerzoi-felirat',
    title: 'How caching actually works',
    channel: 'Synthetic Channel',
    srt: rolling([
      'Caching is not one idea, it is three.',
      'The first is the cache key, which decides what counts as the same request.',
      'The second is invalidation, which decides when a stored answer goes stale.',
      'The third is eviction, which decides what to drop when memory runs out.',
      'Most outages I have seen came from the second one.',
    ]),
    notes: [
      [
        'The video breaks caching into three separate decisions rather than treating it as one technique.',
        '',
        '## The three decisions',
        '',
        '- **Cache key** — decides what counts as the same request.',
        '- **Invalidation** — decides when a stored answer goes stale.',
        '- **Eviction** — decides what to drop when memory runs out.',
        '',
        '## What actually breaks',
        '',
        '- The speaker attributes most outages they have seen to invalidation.',
      ].join('\n'),
    ],
    verdicts: [
      { score: 1, gaps: [] },
      { score: 0.9, gaps: [] },
    ],
  },
  {
    id: 'automatikus-felirat',
    title: 'agent orchestration in practice',
    channel: 'Synthetic Channel',
    srt: rolling([
      'agent orchestration otherwise known as what yes the latest hot trend',
      'for vibe coders or agentic engineers is here in this video',
      'we take a look at whether any of it survives contact with production',
      'the short answer is that the routing layer is the only part that pays off',
    ]),
    notes: [
      // Első kör: hiányos, a bíró meg is nevezi a hiányt.
      [
        'The video is about agent orchestration.',
        '',
        '## Main claim',
        '',
        '- Agent orchestration is a current trend.',
      ].join('\n'),
      // Második kör: a hiány pótolva.
      [
        'The video asks whether agent orchestration survives contact with production.',
        '',
        '## Main claim',
        '',
        '- Agent orchestration is a current trend among "vibe coders" and agentic engineers.',
        '- The speaker says the routing layer is the only part that pays off in production.',
      ].join('\n'),
    ],
    verdicts: [
      { score: 1, gaps: [] },
      { score: 0.4, gaps: ['The conclusion about the routing layer is missing.'] },
      { score: 1, gaps: [] },
      { score: 0.9, gaps: [] },
    ],
  },
  {
    id: 'formatumhiba',
    title: 'a note that breaks the vault rules',
    channel: 'Synthetic Channel',
    srt: rolling([
      'This one exists to prove the format gate stops the expensive scorers.',
      'The generated note contains a wikilink, which the vault forbids.',
    ]),
    notes: [
      // Wikilinket tartalmaz: a blokkoló kritérium megfogja, és a bíró
      // egyetlen hívást sem kap.
      'See [[Another Note]] for the details.',
    ],
    verdicts: [],
  },
]
