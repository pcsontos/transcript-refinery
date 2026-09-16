import { formatCriterion } from '../rubric/format.js'
import { fidelityCriterion } from '../rubric/fidelity.js'
import { judgeCriterion } from '../rubric/judge.js'
import { languageCriterion } from '../rubric/language.js'
import type { SourceItem } from '../types.js'
import { anchorParagraphs } from './anchor.js'
import { languageRule, RULE } from './rules.js'
import type { Recipe } from './types.js'

/**
 * A közös szabályok. Mindkét prompt ugyanezeket idézi, mert a javító körnek
 * ugyanazokat a megkötéseket kell betartania.
 *
 * A hangsúly az **enyhe** szinten van: ez a recept nem jegyzetet ír, hanem
 * ugyanazt a beszédet adja vissza olvashatóan.
 */
const rules = (item: SourceItem): string =>
  [
    languageRule(item),
    RULE.traceable,
    '- This is a cleanup task. Reproduce the speech in full: fix punctuation,',
    '  capitalisation and obvious mishearings, and nothing else.',
    '- Do not summarise, shorten, reorder or paraphrase. Keep filler words.',
    '- Start a new paragraph when the topic shifts; add a `##` heading at larger',
    '  shifts. The heading must follow from the speech below it.',
    '- Do not write timestamps. They are added separately.',
    RULE.noFrontmatter,
    RULE.noWikilinks,
  ].join('\n')

/**
 * A tisztításra szabott hűség-bíró. A megfogalmazás szándékosan más, mint az
 * általános `faithfulnessCriterion`-é: itt nem kitalált állítást keresünk — a
 * jegyzet maga az átirat —, hanem azt, hogy a tisztítás megváltoztatta-e
 * valahol az értelmet.
 */
const cleaningFaithfulness = judgeCriterion({
  name: 'cleaning-faithfulness',
  instruction: [
    'You are grading a cleaned-up transcript against the raw transcript it was',
    'made from. The cleaned version should say the same things, only readable:',
    'punctuation, capitalisation and obvious speech-to-text errors fixed.',
    '',
    'Return a score between 0 and 1, where 1 means the meaning is unchanged',
    'everywhere. Report as a gap every place where the cleanup changed what was',
    'said, dropped a passage, or added something that was not spoken. Section',
    'headings are allowed, but each must follow from the speech underneath it;',
    'a heading that introduces a claim of its own is a gap.',
  ].join('\n'),
})

/**
 * Tisztított leirat a normalizált átiratból, bekezdésenkénti időbélyeggel.
 *
 * A modell prózát ír, időbélyeg nélkül; az időt a `postprocess` teszi bele,
 * a feliratfájl időzítéséből. Így az időbélyeg **nem a modell írása**, tehát
 * nem tud elcsúszni vagy kitalált lenni.
 */
export const cleanRecipe: Recipe = {
  id: 'clean',
  outputFile: '_clean.md',
  publishable: true,
  role: 'draft',
  maxIterations: 0,
  // A kimenet nagyjából akkora, mint a bemenet; a mért korpuszon 1,05×.
  outputRatio: 1.05,

  postprocess: (output, input) => anchorParagraphs(output, input.timed),

  prompt: ({ item, transcript }) =>
    [
      'Clean up the transcript of the video below so that it reads well.',
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
      'Revise the cleaned-up transcript below. A reviewer scored it against the raw',
      'transcript and listed concrete gaps. Fix every gap. Keep what already works —',
      'do not rewrite the text wholesale.',
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
    criteria: [formatCriterion, languageCriterion, fidelityCriterion, cleaningFaithfulness],
    // Egyetlen pontozó kritérium van, tehát a küszöb közvetlenül a bíró
    // ítéletére vonatkozik. A kapuk nem pontoznak, csak átengednek.
    passThreshold: 0.8,
  },
}
