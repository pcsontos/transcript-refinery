import { formatCriterion } from '../rubric/format.js'
import { coverageCriterion, faithfulnessCriterion } from '../rubric/judge.js'
import type { SourceItem } from '../types.js'
import { RULE } from './rules.js'
import type { Recipe } from './types.js'

/**
 * A közös szabályok. Mindkét prompt ugyanezeket idézi, mert a javító körnek
 * ugyanazokat a megkötéseket kell betartania.
 */
const RULES = [
  RULE.language,
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
 * A prompt fejléce. A `Channel:` sor kimarad metaadat híján: az üres vagy
 * kitalált csatornanév félrevezetné a generálást.
 */
function header(item: SourceItem): string[] {
  const lines = [`Title: ${item.title}`]
  if (item.metadata.channel) lines.push(`Channel: ${item.metadata.channel}`)
  return lines
}

/**
 * Kérdés-felelet jegyzet a normalizált átiratból.
 *
 * A `summary` felállását követi: ugyanaz a három kritérium, ugyanaz a küszöb,
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
      RULES,
      '',
      ...header(item),
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
      RULES,
      '',
      ...header(item),
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
    criteria: [formatCriterion, faithfulnessCriterion, coverageCriterion],
    // A két bíró-kritérium átlaga, ahogy a `summary`-nál.
    passThreshold: 0.8,
  },
}
