import { z } from 'zod'
import { formatCriterion } from '../rubric/format.js'
import { coverageCriterion, faithfulnessCriterion } from '../rubric/judge.js'
import type { Criterion, Score } from '../rubric/types.js'
import type { SourceItem } from '../types.js'
import { RULE } from './rules.js'
import { structuredOutput } from './structured.js'
import type { Recipe } from './types.js'

/**
 * A kártyakészlet sémája. A `trim()` a csupa szóköz oldalt is kiszűri, a
 * hármas alsó korlát pedig azt, hogy egy egész videóból egyetlen kártya
 * szülessen. Felső korlátot nem írunk elő: a hosszabb átirat több kártyát
 * érdemel, a költséget pedig a futásonkénti plafon fogja.
 */
export const FlashcardsSchema = z.object({
  cards: z
    .array(
      z.object({
        question: z.string().trim().min(1),
        answer: z.string().trim().min(1),
      }),
    )
    .min(3),
})

export type Flashcards = z.infer<typeof FlashcardsSchema>

/**
 * Kártyakészlet → az Obsidian Decks plugin fejléc-bekezdés alakja: minden
 * `##` fejléc egy kártya eleje, az alatta lévő bekezdés a hátulja.
 *
 * A renderer **normalizál, nem hibázik**. A kérdésbe került sortörés egyetlen
 * sorrá olvad, a válasz `#`-kezdetű sorai escape-et kapnak. Mindkettőt itt
 * kell megoldani, mert a kész szövegben már nem lennének megkülönböztethetők
 * a szabályos kártyahatároktól: a sortörés utáni rész pont úgy néz ki, mint a
 * válasz első sora, a válaszbeli `##` pedig pont úgy, mint egy új kártya.
 * Ugyanaz a megfontolás, mint a futásriport tábláinak cella-escape-elésénél.
 */
export function renderCards({ cards }: Flashcards): string {
  return cards
    .map((card) => {
      const question = card.question.replace(/\s*\n\s*/g, ' ').trim()
      const answer = card.answer.replace(/^(#+)/gm, '\\$1')
      return `## ${question}\n\n${answer}`
    })
    .join('\n\n')
}

/** Egy kártya a renderelt szövegből visszaolvasva. */
function parseCards(output: string): { question: string; body: string }[] {
  const cards: { question: string; body: string[] }[] = []
  for (const line of output.split('\n')) {
    const heading = /^## (.*)$/.exec(line)
    if (heading) {
      cards.push({ question: heading[1]!.trim(), body: [] })
    } else if (cards.length > 0) {
      cards[cards.length - 1]!.body.push(line)
    }
  }
  return cards.map((c) => ({ question: c.question, body: c.body.join('\n').trim() }))
}

/**
 * Determinisztikus kártya-kapu: nulla token, és bukása esetén a bíró-hívások
 * el sem indulnak.
 *
 * Arra való, amit a séma nem tud megfogni, de a renderelt szövegből látszik:
 * két kártya azonos kérdéssel (a modell kedvenc hibája hosszú átiraton) és a
 * válasz nélkül maradt fejléc. A kártyaszám ellenőrzése védelmi réteg a
 * renderer hibája ellen — a sémán már fennakadna.
 *
 * A hiányüzenetek angolul szólnak, mert visszamennek a javító promptba.
 */
export function checkFlashcards(output: string): Score {
  const gaps: string[] = []
  const cards = parseCards(output)

  if (cards.length < 3) {
    gaps.push(
      `The note has ${String(cards.length)} card(s). Write at least three cards, each as a "## question" heading followed by its answer.`,
    )
  }

  for (const card of cards.filter((c) => c.body === '')) {
    gaps.push(`The card "${card.question}" is a heading without an answer below it.`)
  }

  const latott = new Map<string, string>()
  for (const card of cards) {
    const kulcs = card.question.toLocaleLowerCase()
    const elso = latott.get(kulcs)
    if (elso === undefined) {
      latott.set(kulcs, card.question)
    } else {
      gaps.push(
        `Two cards ask the same question: "${elso}". Ask about a different point instead.`,
      )
    }
  }

  return { value: gaps.length === 0 ? 1 : 0, gaps }
}

/** Kapu-kritérium: bukása esetén a bíró-hívások el sem indulnak. */
const flashcardFormatCriterion: Criterion = {
  name: 'flashcards-format',
  blocking: true,
  score: (ctx) => Promise.resolve(checkFlashcards(ctx.output)),
}

const RULES = [
  RULE.language,
  RULE.traceable,
  '- One card per idea. Ask about a single fact, definition, or causal link.',
  '- The question must be answerable from the transcript alone, without the video.',
  '- Keep the answer to one or two sentences.',
  '- Do not ask the same question twice.',
  RULE.noFrontmatter,
  RULE.noWikilinks,
  '- Aim for 8 to 15 cards for a typical video; never fewer than three.',
].join('\n')

/**
 * A prompt fejléce. A `Channel:` sor kimarad metaadat híján: az üres vagy
 * kitalált csatornanév félrevezetné a generálást.
 */
function header(item: SourceItem): string[] {
  const lines = [`Title: ${item.title}`]
  if (item.metadata.channel) lines.push(`Channel: ${item.metadata.channel}`)
  return lines
}

/**
 * Az első strukturált recept: tanulókártyák a normalizált átiratból.
 *
 * A modell nem sorformátumot ír, hanem objektumot ad: a `##` elválasztó a
 * rendererre tartozik, tehát a vault-formátum sosem a modell figyelmén múlik.
 */
export const flashcardsRecipe: Recipe = {
  id: 'flashcards',
  outputFile: '_flashcards.md',
  publishable: true,
  role: 'draft',
  maxIterations: 2,

  structured: structuredOutput(FlashcardsSchema, renderCards),

  prompt: ({ item, transcript }) =>
    [
      'Write study flashcards from the transcript of the video below.',
      '',
      'Rules:',
      RULES,
      '',
      ...header(item),
      '',
      '--- TRANSCRIPT ---',
      transcript,
    ].join('\n'),

  repairPrompt: ({ item, transcript, previous, gaps }) =>
    [
      'Revise the flashcards below. A reviewer scored them against the transcript and',
      'listed concrete gaps. Fix every gap. Keep the cards that already work — do not',
      'rewrite the whole set.',
      '',
      'The original rules still apply:',
      RULES,
      '',
      ...header(item),
      '',
      '--- GAPS TO FIX ---',
      ...gaps.map((gap) => `- ${gap}`),
      '',
      '--- CURRENT CARDS ---',
      previous,
      '',
      '--- TRANSCRIPT ---',
      transcript,
    ].join('\n'),

  rubric: {
    criteria: [
      formatCriterion,
      flashcardFormatCriterion,
      faithfulnessCriterion,
      coverageCriterion,
    ],
    // A két bíró-kritérium átlaga, ahogy a `summary`-nál: a kapuk nem
    // pontoznak, csak átengednek vagy megállítanak.
    passThreshold: 0.8,
  },
}
