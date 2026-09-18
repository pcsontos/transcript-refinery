import { z } from 'zod'
import { formatCriterion } from '../rubric/format.js'
import { coverageCriterion, pedagogicalFaithfulnessCriterion } from '../rubric/judge.js'
import { languageCriterion } from '../rubric/language.js'
import type { Criterion, Score } from '../rubric/types.js'
import type { SourceItem } from '../types.js'
import { checkCardBasics, parseCards } from './cards.js'
import { escapeHeadings, singleLine } from './markdown.js'
import { languageRule, pedagogicalRule, RULE } from './rules.js'
import { structuredOutput } from './structured.js'
import type { Recipe } from './types.js'

/** A Bloom-taxonómia hat szintje, a kognitív igény növekvő sorrendjében. */
export const BLOOM_LEVELS = [
  'remember',
  'understand',
  'apply',
  'analyze',
  'evaluate',
  'create',
] as const
export type BloomLevel = (typeof BLOOM_LEVELS)[number]

const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'] as const
type Difficulty = (typeof DIFFICULTIES)[number]

const LEVEL_LABELS: Record<BloomLevel, string> = {
  remember: 'Remember',
  understand: 'Understand',
  apply: 'Apply',
  analyze: 'Analyze',
  evaluate: 'Evaluate',
  create: 'Create',
}

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
}

const MIN_PER_LEVEL = 3
const MAX_PER_LEVEL = 5

/** A renderer által írt címkesor; a kapu ebből olvassa vissza a szintet. */
const LABEL =
  /^\*(Remember|Understand|Apply|Analyze|Evaluate|Create) · (Beginner|Intermediate|Advanced)\*$/

/**
 * A pakli sémája. A szintenkénti darabszám **szándékosan nem** itt van: a
 * sémahiba `item:failed`, nyom nélkül; a kapu viszont megnevezett hiánnyal,
 * látható 0-s pontszámmal publikál (spec, 4. szakasz). Opcionális mező nincs,
 * mert a gateway `strict: true` sémát kap.
 */
export const BloomSchema = z.object({
  cards: z
    .array(
      z.object({
        level: z.enum(BLOOM_LEVELS),
        difficulty: z.enum(DIFFICULTIES),
        question: z.string().trim().min(1),
        answer: z.string().trim().min(1),
        explanation: z.string().trim().min(1),
      }),
    )
    .min(1),
})

export type Bloom = z.infer<typeof BloomSchema>

/**
 * Pakli → a Decks fejléc-bekezdés alakja, szintsorrendben. A szint és a
 * nehézség a kártya **utolsó** sorában áll, dőlt címkeként: a Decks
 * alapbeállításával működik, és a kapu ebből olvassa vissza.
 */
export function renderBloom({ cards }: Bloom): string {
  return BLOOM_LEVELS.flatMap((level) => cards.filter((card) => card.level === level))
    .map((card) =>
      [
        `## ${singleLine(card.question)}`,
        escapeHeadings(card.answer),
        `**Why:** ${escapeHeadings(card.explanation)}`,
        `*${LEVEL_LABELS[card.level]} · ${DIFFICULTY_LABELS[card.difficulty]}*`,
      ].join('\n\n'),
    )
    .join('\n\n')
}

/**
 * Determinisztikus Bloom-kapu, nulla token. A közös kártyaellenőrzéseken túl
 * minden kártya címkesorral zárul-e (a renderer hibája elleni védőréteg), és
 * mind a hat szinten 3–5 kártya van-e. Angolul, mert a modellnek szól.
 */
export function checkBloom(output: string): Score {
  const cards = parseCards(output)
  const gaps = checkCardBasics(cards)

  const counts = new Map<string, number>(Object.values(LEVEL_LABELS).map((label) => [label, 0]))
  for (const card of cards) {
    const last = card.body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .at(-1)
    const label = last === undefined ? null : LABEL.exec(last)
    if (!label) {
      gaps.push(`The card "${card.question}" does not end with a level label.`)
      continue
    }
    counts.set(label[1]!, (counts.get(label[1]!) ?? 0) + 1)
  }

  for (const [label, count] of counts) {
    if (count < MIN_PER_LEVEL || count > MAX_PER_LEVEL) {
      gaps.push(
        `The level "${label}" has ${String(count)} card(s). Write ${String(MIN_PER_LEVEL)} to ${String(MAX_PER_LEVEL)} cards for every level.`,
      )
    }
  }

  return { value: gaps.length === 0 ? 1 : 0, gaps }
}

/** Kapu-kritérium: bukása esetén a bíró-hívások el sem indulnak. */
const bloomFormatCriterion: Criterion = {
  name: 'bloom-format',
  blocking: true,
  score: (ctx) => Promise.resolve(checkBloom(ctx.output)),
}

/**
 * A bíró a RENDERELT jegyzetet olvassa, ezért a szabad zónát a renderer
 * címkéivel nevezzük meg. A magasabb szinteken a kérdés is szabad, mert maga
 * állít fel új helyzetet.
 */
export const BLOOM_FREE_PARTS =
  'the question and answer of every card whose last line is labelled Apply, Analyze, Evaluate or Create, and every paragraph that starts with **Why:**'

/** A modell a sémát tölti ki, ezért a promptban a sémamezők nyelvén szólunk. */
const FREE_IN_PROMPT =
  'the question and answer of apply, analyze, evaluate and create cards, and every explanation'

const rules = (item: SourceItem): string =>
  [
    languageRule(item),
    pedagogicalRule(FREE_IN_PROMPT),
    '- Remember and understand cards must be answerable from the transcript alone.',
    "- Organise the cards by the six levels of Bloom's taxonomy:",
    '  remember: recall facts and terms (define, identify, list, recall);',
    '  understand: explain ideas (describe, explain, summarise, classify);',
    '  apply: use a procedure in a situation (apply, demonstrate, implement, solve);',
    '  analyze: break it into parts and relate them (compare, contrast, differentiate);',
    '  evaluate: judge against criteria (assess, critique, justify, recommend);',
    '  create: combine ideas into something new (design, formulate, plan, synthesise).',
    '- Write 3 to 5 cards for every level.',
    '- Rate each card beginner, intermediate or advanced; aim for roughly 40% beginner,',
    '  40% intermediate and 20% advanced.',
    '- The question must make sense on its own, without the video.',
    '- Keep the answer to one or two sentences and the explanation to two or three.',
    '- Do not ask the same question twice.',
    RULE.noFrontmatter,
    RULE.noWikilinks,
  ].join('\n')

/**
 * Bloom-taxonómiás tanulókártyák: szintenként 3–5 kártya, válasszal, rövid
 * magyarázattal, szint- és nehézségcímkével. Önálló recept a `flashcards`
 * mellett, nem annak bővítése.
 */
export const bloomRecipe: Recipe = {
  id: 'bloom',
  outputFile: '_bloom.md',
  publishable: true,
  role: 'draft',
  maxIterations: 0,
  // A medián elemen mért kimeneti arány, felfelé kerekítve
  // (docs/measurements/2026-09-17-bloom-notes-kalibralas.md).
  outputRatio: 0.81,
  tags: ['decks'],
  // Egy `##` fejléc egy kártya: a fordítás nem veszíthet és nem nyerhet
  // fejlécet.
  headingsAreContent: true,

  structured: structuredOutput(BloomSchema, renderBloom),

  prompt: ({ item, transcript }) =>
    [
      "Write study flashcards organised by the levels of Bloom's taxonomy from the transcript of the video below.",
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
      bloomFormatCriterion,
      languageCriterion,
      pedagogicalFaithfulnessCriterion(BLOOM_FREE_PARTS),
      coverageCriterion,
    ],
    // A két bíró-kritérium átlaga, ahogy a `flashcards`-nál.
    passThreshold: 0.8,
  },
}
