import { formatCriterion } from '../rubric/format.js'
import { coverageCriterion, faithfulnessCriterion } from '../rubric/judge.js'
import { languageCriterion } from '../rubric/language.js'
import type { SourceItem } from '../types.js'
import { languageRule, RULE } from './rules.js'
import type { Recipe } from './types.js'

/**
 * A közös szabályok. Mindkét prompt ugyanezeket idézi, mert a javító körnek
 * ugyanazokat a megkötéseket kell betartania.
 */
const rules = (item: SourceItem): string =>
  [
    languageRule(item),
    RULE.traceable,
    '- Write question-and-answer pairs in prose. Put the question in bold on its',
    '  own line, then the answer in the paragraph below it.',
    '- Every question must be answerable from the transcript alone.',
    '- Ask about substance, not about the speaker or the video itself.',
    RULE.noFrontmatter,
    RULE.noWikilinks,
    '- Cover the main points; roughly one pair per distinct idea.',
  ].join('\n')

/**
 * Kérdés-felelet jegyzet a normalizált átiratból.
 *
 * A `summary` felállását követi: ugyanaz a négy kritérium, ugyanaz a küszöb,
 * ugyanaz az iterációs korlát. A különbség a promptban van — és pontosan ez
 * az, amit ez a recept bizonyít: egy új dokumentumtípus felvétele nem
 * architekturális esemény, a motorhoz nem kell nyúlni.
 */
export const qaRecipe: Recipe = {
  id: 'qa',
  outputFile: '_qa.md',
  publishable: true,
  role: 'draft',
  maxIterations: 2,

  prompt: ({ item, transcript }) =>
    [
      'Write a question-and-answer study note from the transcript of the video below.',
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
      'Revise the question-and-answer note below. A reviewer scored it against the',
      'transcript and listed concrete gaps. Fix every gap. Keep what already works —',
      'do not rewrite the note wholesale.',
      '',
      'The original rules still apply:',
      rules(item),
      '',
      `Title: ${item.title}`,
      '',
      '--- GAPS TO FIX ---',
      ...gaps.map((gap) => `- ${gap}`),
      '',
      '--- CURRENT NOTE ---',
      previous,
      '',
      '--- TRANSCRIPT ---',
      transcript,
    ].join('\n'),

  rubric: {
    criteria: [formatCriterion, languageCriterion, faithfulnessCriterion, coverageCriterion],
    // A két bíró-kritérium átlaga, ahogy a `summary`-nál.
    passThreshold: 0.8,
  },
}
