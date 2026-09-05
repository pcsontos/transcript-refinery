import type { CaptionSource } from '../../src/types.js'

/**
 * A minőségi kapu **publikus, címkézett** halmaza. Szintetikus szövegek, a
 * valós korpusz alakzatait utánozva: a kapu maga determinisztikus, de a
 * **küszöbérték ítélet**, tehát mérni kell (`evaluation.md` §1).
 */
export interface GateLabel {
  id: string
  text: string
  /** A kézzel adott, mérvadó címke. */
  label: CaptionSource
}

export const GATE_LABELS: GateLabel[] = [
  {
    id: 'szerzoi-1',
    label: 'creator',
    text: 'Caching is not one idea, it is three. The first is the cache key, which decides what counts as the same request. The second is invalidation.',
  },
  {
    id: 'szerzoi-2',
    label: 'creator',
    text: 'Welcome back! Today we look at three things: routing, retries, and rate limits. Each one is simple; together, they are not.',
  },
  {
    id: 'szerzoi-3',
    label: 'creator',
    text: 'So, what happened? The deploy went out at 3 a.m., and by 4, everything was on fire. Here is the timeline.',
  },
  {
    id: 'automatikus-1',
    label: 'auto',
    text: 'agent orchestration otherwise known as what yes the latest hot trend for vibe coders or agentic engineers is here in this video we take a look',
  },
  {
    id: 'automatikus-2',
    label: 'auto',
    text: 'so the first thing you want to do is open up your terminal and then you are going to want to run the install command and wait for it to finish',
  },
  {
    id: 'automatikus-3',
    label: 'auto',
    text: 'And so what I did was I took the whole thing apart and then I put it back together again and it turns out that the problem was the cable',
  },
  {
    id: 'hatareset',
    label: 'auto',
    // A valós korpusz egyetlen határesetének szintetikus mása: az újabb ASR
    // nagybetűsít és néha pontot tesz, de a sűrűség a küszöb körül marad.
    // Pontosan ez az az elem, ami elkapja, ha a küszöb elcsúszik.
    text: 'The thing about this approach is that it works until it does not and then you are left holding a system that nobody understands anymore and the person who wrote it left the company two years ago so there is nobody to ask about any of it. And that is the real cost',
  },
]
