import { z } from 'zod'
import type { Criterion, ScoreContext } from './types.js'

/**
 * A bíró strukturált ítélete. A séma kényszeríti ki, hogy pontszám **és**
 * hiánylista is legyen — enélkül a modell hajlamos csak számot adni, és a
 * loop nem tudna miből javítani.
 */
const Verdict = z.object({
  score: z.number().min(0).max(1),
  gaps: z.array(z.string()),
})

function buildPrompt(instruction: string, ctx: ScoreContext): string {
  const parts = [instruction, '', '--- TRANSCRIPT ---', ctx.transcript]

  if (ctx.keyPoints && ctx.keyPoints.length > 0) {
    parts.push(
      '',
      '--- MAIN POINTS (authoritative) ---',
      ...ctx.keyPoints.map((point) => `- ${point}`),
    )
  }

  parts.push('', '--- NOTES UNDER REVIEW ---', ctx.output)
  return parts.join('\n')
}

/**
 * Modell-bíró kritérium. Az értékelő szerep alapból **más modell**, mint a
 * generáló: ha ugyanaz a modell pontozná a saját kimenetét, az
 * önpreferencia-torzítás miatt a mérés kevesebbet érne (`architecture.md` §8).
 */
export function judgeCriterion(opts: {
  name: string
  instruction: string
}): Criterion {
  return {
    name: opts.name,
    async score(ctx, client) {
      const { value, usage } = await client.generateObject(
        'judge',
        buildPrompt(opts.instruction, ctx),
        Verdict,
      )
      return { value: value.score, gaps: value.gaps, usage }
    },
  }
}

export const faithfulnessCriterion = judgeCriterion({
  name: 'faithfulness',
  instruction: [
    'You are grading a set of notes against the transcript they were written from.',
    '',
    'Rule: every claim in the notes must be traceable to the transcript. A claim',
    'that is true in general but never stated in the transcript is a failure, not',
    'a bonus. Paraphrase is fine; invention is not.',
    '',
    'Return a score between 0 and 1, where 1 means every claim is supported.',
    'List each unsupported claim as its own gap, quoting the offending phrase.',
    'An empty gap list means the notes are fully supported.',
  ].join('\n'),
})

export const coverageCriterion = judgeCriterion({
  name: 'coverage',
  instruction: [
    "You are grading a set of notes for coverage of the transcript's main points.",
    '',
    'If a list of main points is given below, treat it as authoritative and do',
    'not derive your own. Otherwise, first determine the main points of the',
    'transcript yourself, then check which of them the notes cover.',
    '',
    'Return a score between 0 and 1, where 1 means every main point is covered.',
    'List each missing main point as its own gap, stated concretely enough that',
    'a writer could add it without re-reading the transcript.',
  ].join('\n'),
})
