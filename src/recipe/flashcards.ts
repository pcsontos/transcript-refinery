import { z } from 'zod'
import { formatCriterion } from '../rubric/format.js'
import { coverageCriterion, faithfulnessCriterion } from '../rubric/judge.js'
import { languageCriterion } from '../rubric/language.js'
import type { Criterion, Score } from '../rubric/types.js'
import type { SourceItem } from '../types.js'
import { checkCardBasics, parseCards } from './cards.js'
import { escapeHeadings, singleLine } from './markdown.js'
import { languageRule, RULE } from './rules.js'
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
 * sorrá olvad, a válasz fejléc-alakú sorai escape-et kapnak. Mindkettőt itt
 * kell megoldani, mert a kész szövegben már nem lennének megkülönböztethetők
 * a szabályos kártyahatároktól (`markdown.ts`).
 */
export function renderCards({ cards }: Flashcards): string {
  return cards
    .map((card) => `## ${singleLine(card.question)}\n\n${escapeHeadings(card.answer)}`)
    .join('\n\n')
}

/**
 * Determinisztikus kártya-kapu: nulla token, és bukása esetén a bíró-hívások
 * el sem indulnak.
 *
 * A közös ellenőrzéseken (`cards.ts`) túl a kártyaszámot nézi — védelmi réteg
 * a renderer hibája ellen, a sémán már fennakadna.
 *
 * A hiányüzenetek angolul szólnak, mert visszamennek a javító promptba.
 */
export function checkFlashcards(output: string): Score {
  const cards = parseCards(output)
  const gaps: string[] = []

  if (cards.length < 3) {
    gaps.push(
      `The note has ${String(cards.length)} card(s). Write at least three cards, each as a "## question" heading followed by its answer.`,
    )
  }
  gaps.push(...checkCardBasics(cards))

  return { value: gaps.length === 0 ? 1 : 0, gaps }
}

/** Kapu-kritérium: bukása esetén a bíró-hívások el sem indulnak. */
const flashcardFormatCriterion: Criterion = {
  name: 'flashcards-format',
  blocking: true,
  score: (ctx) => Promise.resolve(checkFlashcards(ctx.output)),
}

const rules = (item: SourceItem): string =>
  [
    languageRule(item),
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
  maxIterations: 0,

  structured: structuredOutput(FlashcardsSchema, renderCards),

  prompt: ({ item, transcript }) =>
    [
      'Write study flashcards from the transcript of the video below.',
      '',
      'Rules:',
      rules(item),
      '',
      `Title: ${item.title}`,
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
      rules(item),
      '',
      `Title: ${item.title}`,
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
      languageCriterion,
      faithfulnessCriterion,
      coverageCriterion,
    ],
    // A két bíró-kritérium átlaga, ahogy a `summary`-nál: a kapuk nem
    // pontoznak, csak átengednek vagy megállítanak.
    passThreshold: 0.8,
  },
}
