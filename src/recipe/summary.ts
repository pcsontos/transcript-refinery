import { coverageCriterion, faithfulnessCriterion } from '../rubric/judge.js'
import { formatCriterion } from '../rubric/format.js'
import { languageCriterion } from '../rubric/language.js'
import type { SourceItem } from '../types.js'
import { languageRule, RULE } from './rules.js'
import type { Recipe } from './types.js'

/**
 * A közös szabályok. Mindkét prompt ugyanezeket idézi, mert a javító kör
 * ugyanazokat a megkötéseket kell hogy betartsa — enélkül a második
 * generálás kijavítaná a tartalmi hiányt, és közben elrontaná a formátumot.
 *
 * A vault-invariáns tagok a `rules.ts`-ből jönnek; a szerkezeti és a hossz-
 * szabály ezé a recepté. A sorrend szándékos: a szerkezeti szabály a
 * visszavezethetőség után áll, mert az olvasás sorrendje is ez.
 */
const rules = (item: SourceItem): string =>
  [
    languageRule(item),
    RULE.traceable,
    [
      '- Open with a short paragraph on what the video is about, then use `##`',
      '  sections with bullet points for the substance.',
    ].join('\n'),
    RULE.noFrontmatter,
    RULE.noWikilinks,
    "- Aim for roughly a tenth of the transcript's length.",
  ].join('\n')

/**
 * Az első recept: strukturált tanulójegyzet a normalizált átiratból.
 *
 * A `_summary.md` utótag az elem alapnevéhez (`<alapnév>_summary.md`)
 * illeszkedik, a forrásmappát tükröző vault-almappában — lásd
 * `docs/decisions/0008`.
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
      rules(item),
      '',
      `Title: ${item.title}`,
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
      rules(item),
      '',
      `Title: ${item.title}`,
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
    criteria: [formatCriterion, languageCriterion, faithfulnessCriterion, coverageCriterion],
    // A két bíró-kritérium átlaga. A 0,8 azt jelenti: a hűség és a
    // lefedettség együtt legfeljebb egy közepes hiányt viselhet el.
    passThreshold: 0.8,
  },
}
