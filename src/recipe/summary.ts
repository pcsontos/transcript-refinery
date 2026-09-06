import { coverageCriterion, faithfulnessCriterion } from '../rubric/judge.js'
import { formatCriterion } from '../rubric/format.js'
import type { SourceItem } from '../types.js'
import type { Recipe } from './types.js'

/**
 * A közös szabályok. Mindkét prompt ugyanezeket idézi, mert a javító kör
 * ugyanazokat a megkötéseket kell hogy betartsa — enélkül a második
 * generálás kijavítaná a tartalmi hiányt, és közben elrontaná a formátumot.
 */
const RULES = [
  '- Write in the same language as the transcript. Do not translate.',
  '- Every statement must be traceable to the transcript. Do not add outside',
  '  knowledge, and do not speculate about what the speaker meant.',
  '- Open with a short paragraph on what the video is about, then use `##`',
  '  sections with bullet points for the substance.',
  '- Do not emit YAML frontmatter; it is added separately.',
  '- Do not use wikilinks (`[[...]]`). If you link, wrap the target in angle',
  '  brackets: `[Name](<https://example.com>)`.',
  "- Aim for roughly a tenth of the transcript's length.",
].join('\n')

/**
 * A prompt fejléce. A `Channel:` sor **kimarad**, ha nincs metaadat: az üres
 * vagy kitalált csatornanév félrevezetné a generálást, és a rubrika olyan
 * kontextust kérne számon, ami nem is létezett.
 */
function header(item: SourceItem): string[] {
  const lines = [`Title: ${item.title}`]
  if (item.metadata.channel) lines.push(`Channel: ${item.metadata.channel}`)
  return lines
}

/**
 * Az első recept: strukturált tanulójegyzet a normalizált átiratból.
 *
 * A `_summary.md` utótag a vault bejáratott névkonvenciója
 * (`Youtube - <cím>_<típus>.md`), tehát a kimenet a meglévő fájlok mellé
 * illeszkedik, nem egy külön beérkező mappába.
 */
export const summaryRecipe: Recipe = {
  id: 'summary',
  outputFile: '_summary.md',
  publishable: true,
  role: 'draft',
  maxIterations: 2,

  prompt: ({ item, transcript }) =>
    [
      'Write structured study notes from the transcript of the video below.',
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
      'Revise the notes below. A reviewer scored them against the transcript and',
      'listed concrete gaps. Fix every gap. Keep what already works — do not rewrite',
      'the notes wholesale.',
      '',
      'The original rules still apply:',
      RULES,
      '',
      ...header(item),
      '',
      '--- GAPS TO FIX ---',
      ...gaps.map((gap) => `- ${gap}`),
      '',
      '--- CURRENT NOTES ---',
      previous,
      '',
      '--- TRANSCRIPT ---',
      transcript,
    ].join('\n'),

  rubric: {
    criteria: [formatCriterion, faithfulnessCriterion, coverageCriterion],
    // A két bíró-kritérium átlaga. A 0,8 azt jelenti: a hűség és a
    // lefedettség együtt legfeljebb egy közepes hiányt viselhet el.
    passThreshold: 0.8,
  },
}
