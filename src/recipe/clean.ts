import { formatCriterion } from '../rubric/format.js'
import { fidelityCriterionFor, type FidelityThresholds } from '../rubric/fidelity.js'
import { judgeCriterion } from '../rubric/judge.js'
import { languageCriterion } from '../rubric/language.js'
import type { SourceItem } from '../types.js'
import { anchorParagraphs } from './anchor.js'
import { languageRule, RULE } from './rules.js'
import type { Recipe } from './types.js'

/** A tisztított leirat szerkesztési szintje (backlog 2.8, #83). */
export type CleanLevel = 'mild' | 'moderate' | 'deep'

export const CLEAN_LEVELS: readonly CleanLevel[] = ['mild', 'moderate', 'deep']

/**
 * A hűségkapu küszöbei szintenként. Mért értékek (2026-09-25,
 * `sub2api--claude-opus-5-5`), a mért minimum mínusz 0,05 — lásd
 * `docs/measurements/2026-09-25-clean-szintek-kalibralas.md`.
 */
export const CLEAN_THRESHOLDS: Record<CleanLevel, FidelityThresholds> = {
  mild: { minWordRatio: 0.86, minCoverage: 0.84, task: 'cleanup' },
  moderate: { minWordRatio: 0.86, minCoverage: 0.82, task: 'cleanup' },
  deep: { minWordRatio: 0.68, minCoverage: 0.59, task: 'edit' },
}

/**
 * A költségbecslés kimeneti aránya szintenként: a medián elemen mért
 * tokenarány, felfelé kerekítve (ugyanaz a mérés). Hogy miért van egy fölött,
 * nincs ellenőrizve: a mért érték a modell saját kimeneti tokenszáma a
 * `postprocess` előtt, tehát az időbélyegek nem számítanak bele, és a deep
 * (időbélyeg nélkül) is 1,11–1,13 a medián és a leghosszabb elemen.
 * Lehetséges, nem igazolt okok: a modell tokenizálója eltér a
 * `TOKENS_PER_WORD = 1.35` feltevéstől, vagy a kimeneti token gondolkodási
 * tokeneket is tartalmaz.
 */
const OUTPUT_RATIO: Record<CleanLevel, number> = { mild: 1.3, moderate: 1.3, deep: 1.14 }

/**
 * A töltelékszó-szabály: minden szinten ugyanaz. A „jelentést hordoz" kitétel
 * nélkül a modell a tartalmas *so*-t és *like*-ot is kihúzná.
 */
const FILLER_RULE = [
  '- Remove filler words and hesitations (for example "uh", "um", "you know", or in',
  '  Hungarian "öö", "hát", "ugye", "szóval", "na", "tehát" used as fillers). Keep a',
  '  word when it carries meaning in the sentence.',
].join('\n')

const LEVEL_RULES: Record<CleanLevel, string[]> = {
  mild: [
    '- This is a light cleanup. Reproduce the speech in full: fix punctuation,',
    '  capitalisation and obvious mishearings, and nothing else.',
    FILLER_RULE,
    '- Do not summarise, shorten, reorder or paraphrase. Do not add headings.',
    '- Start a new paragraph only where the topic clearly shifts.',
  ],
  moderate: [
    '- This is a cleanup task. Reproduce the speech in full: fix punctuation,',
    '  capitalisation and obvious mishearings, and nothing else.',
    FILLER_RULE,
    '- Do not summarise, shorten, reorder or paraphrase.',
    '- Start a new paragraph when the topic shifts; add a `##` heading at larger',
    '  shifts. The heading must follow from the speech below it.',
  ],
  deep: [
    '- This is an editing task: turn the speech into well-written prose. Smooth the',
    '  style and rephrase spoken constructions as written ones.',
    FILLER_RULE,
    '- Also remove false starts and repetitions.',
    '- Keep every point, example and claim the speaker makes. Do not summarise, and',
    '  do not add anything that was not said.',
    '- Start a new paragraph when the topic shifts; add a `##` heading at larger',
    '  shifts. The heading must follow from the text below it.',
  ],
}

const OPENING: Record<CleanLevel, string> = {
  mild: 'Clean up the transcript of the video below so that it reads well.',
  moderate: 'Clean up the transcript of the video below so that it reads well.',
  deep: 'Edit the transcript of the video below into well-written prose.',
}

const JUDGE_INSTRUCTION: Record<CleanLevel, string[]> = {
  mild: [
    'You are grading a lightly cleaned-up transcript against the raw transcript it',
    'was made from. The cleaned version should say the same things, only readable:',
    'punctuation, capitalisation and obvious speech-to-text errors fixed, filler',
    'words removed. Missing headings or sparse paragraphing are NOT gaps.',
    '',
    'Return a score between 0 and 1, where 1 means the meaning is unchanged',
    'everywhere. Report as a gap every place where the cleanup changed what was',
    'said, dropped a passage, or added something that was not spoken.',
  ],
  moderate: [
    'You are grading a cleaned-up transcript against the raw transcript it was',
    'made from. The cleaned version should say the same things, only readable:',
    'punctuation, capitalisation and obvious speech-to-text errors fixed, filler',
    'words removed. Removing a filler word is NOT a gap.',
    '',
    'Return a score between 0 and 1, where 1 means the meaning is unchanged',
    'everywhere. Report as a gap every place where the cleanup changed what was',
    'said, dropped a passage, or added something that was not spoken. Section',
    'headings are allowed, but each must follow from the speech underneath it;',
    'a heading that introduces a claim of its own is a gap.',
  ],
  deep: [
    'You are grading an edited, written-prose version of a transcript against the',
    'raw transcript it was made from. Rephrasing, smoothing, and dropping fillers,',
    'false starts and repetitions are expected and are NOT gaps.',
    '',
    'Return a score between 0 and 1, where 1 means every point, example and claim',
    'of the speech is present and unchanged in meaning. Report as a gap every',
    'point that was dropped, every claim whose meaning changed, and anything added',
    'that was not said. Section headings are allowed, but each must follow from the',
    'text underneath it.',
  ],
}

/** A közös szabályok; a prompt és a javító prompt ugyanezt idézi. */
const rulesFor =
  (level: CleanLevel) =>
  (item: SourceItem): string =>
    [
      languageRule(item),
      RULE.traceable,
      ...LEVEL_RULES[level],
      // A deep nem kap időbélyeget, tehát nincs mit „külön hozzáadni".
      level === 'deep'
        ? '- Do not write timestamps.'
        : '- Do not write timestamps. They are added separately.',
      RULE.noFrontmatter,
      RULE.noWikilinks,
    ].join('\n')

function build(level: CleanLevel): Recipe {
  const rules = rulesFor(level)
  const anchored = level !== 'deep'
  const judge = judgeCriterion({
    name: 'cleaning-faithfulness',
    instruction: JUDGE_INSTRUCTION[level].join('\n'),
  })
  return {
    id: `clean-${level}`,
    outputFile: `_clean-${level}.md`,
    publishable: true,
    role: 'draft',
    maxIterations: 0,
    outputRatio: OUTPUT_RATIO[level],
    // A deep átfogalmaz: a bekezdés eleje nem illeszthető vissza az átiratba,
    // tehát az időbélyeg nem lenne hiteles (a felhasználó döntése: nincs).
    ...(anchored
      ? {
          postprocess: (output: string, input: Parameters<NonNullable<Recipe['postprocess']>>[1]) =>
            anchorParagraphs(output, input.timed),
          anchored: true,
        }
      : {}),

    prompt: ({ item, transcript }) =>
      [
        OPENING[level],
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
        'Revise the text below. A reviewer scored it against the raw transcript and',
        'listed concrete gaps. Fix every gap. Keep what already works — do not',
        'rewrite the text wholesale.',
        '',
        'The original rules still apply:',
        rules(item),
        '',
        `Title: ${item.title}`,
        '',
        '--- GAPS TO FIX ---',
        ...gaps.map((gap) => `- ${gap}`),
        '',
        '--- CURRENT TEXT ---',
        previous,
        '',
        '--- TRANSCRIPT ---',
        transcript,
      ].join('\n'),

    rubric: {
      criteria: [formatCriterion, languageCriterion, fidelityCriterionFor(CLEAN_THRESHOLDS[level]), judge],
      // Egyetlen pontozó kritérium van, tehát a küszöb közvetlenül a bíró
      // ítéletére vonatkozik. A kapuk nem pontoznak, csak átengednek.
      passThreshold: 0.8,
    },
  }
}

const BY_LEVEL = new Map(CLEAN_LEVELS.map((level) => [level, build(level)] as const))

/**
 * A tisztított leirat receptje a megadott szinten. A töltelékszavakat minden
 * szint eltávolítja; a mild és a moderate bekezdésenkénti időbélyeget kap a
 * feliratfájl időzítéséből (`postprocess`), a deep nem.
 */
export function cleanRecipeFor(level: CleanLevel): Recipe {
  return BY_LEVEL.get(level)!
}

export const CLEAN_RECIPES: readonly Recipe[] = CLEAN_LEVELS.map(cleanRecipeFor)
