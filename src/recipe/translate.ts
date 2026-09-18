import { identifyLanguage, LANGUAGE_NAMES, type LanguageTag } from '../lang/identify.js'
import { formatCriterion } from '../rubric/format.js'
import { judgeCriterion } from '../rubric/judge.js'
import { targetLanguageCriterion } from '../rubric/language.js'
import { skeletonCriterionFor } from '../rubric/skeleton.js'
import type { Criterion } from '../rubric/types.js'
import { RULE } from './rules.js'
import type { Recipe } from './types.js'

/** A nyelvek magyar neve, a felhasználónak szóló kihagyási okhoz. */
const HUNGARIAN_NAMES: Record<LanguageTag, string> = {
  en: 'angol',
  hu: 'magyar',
  nl: 'holland',
  de: 'német',
  es: 'spanyol',
  fr: 'francia',
  it: 'olasz',
}

/**
 * A közös szabályok. Mindkét prompt ugyanezeket idézi, mert a javító körnek
 * ugyanazokat a megkötéseket kell betartania.
 *
 * A `languageRule` és a `RULE.traceable` szándékosan hiányzik: az előbbi
 * fordítást tilt, az utóbbi az átiratra hivatkozik, holott a bemenet itt egy
 * kész jegyzet.
 */
const rules = (target: LanguageTag): string => {
  const name = LANGUAGE_NAMES[target]
  return [
    '- Translate everything: headings, paragraphs, list items, table cells, labels',
    '  such as **Example:**, and the text of Mermaid node labels.',
    '- Keep the Markdown structure exactly: the same headings at the same levels, the',
    '  same paragraphs, list items, table rows and columns, and code fences.',
    '- Keep every timestamp such as [03:12] exactly as it is, at the start of the',
    '  same paragraph.',
    '- In Mermaid code, keep node IDs, arrows and keywords unchanged.',
    '- Keep link targets unchanged; translate only the link text.',
    "- Do not add, drop, summarise or explain anything. Do not add a translator's",
    '  note.',
    `- Technical terms that ${name} professionals usually say in English may stay`,
    '  in English. Treat each such term the same way throughout.',
    RULE.noFrontmatter,
    RULE.noWikilinks,
  ].join('\n')
}

/**
 * A fordítás hűsége a forrásjegyzethez mérve. A bíró promptjának szakaszcímeit
 * (`TRANSCRIPT`, `NOTES UNDER REVIEW`) a `judge.ts` adja; az utasítás mondja
 * meg, mit jelentenek itt — így a `judge.ts` változatlan marad.
 */
function translationFaithfulness(target: LanguageTag): Criterion {
  const name = LANGUAGE_NAMES[target]
  return judgeCriterion({
    name: 'translation-faithfulness',
    instruction: [
      `You are grading a translation into ${name}. The TRANSCRIPT section below holds`,
      'the source note; the NOTES UNDER REVIEW section holds its translation.',
      '',
      'Return a score between 0 and 1, where 1 means the translation says exactly what',
      `the source says, in natural ${name}.`,
      '',
      'Report as a gap every place where the meaning changed, a passage was dropped or',
      `added, or text was left untranslated. Technical terms that ${name}`,
      'professionals usually say in English may stay in English, but the same term must',
      'be handled the same way throughout; report inconsistent handling as a gap.',
      '',
      'Do not report differences in Markdown structure; they are checked separately.',
    ].join('\n'),
  })
}

/**
 * Egy recept kész jegyzetének célnyelvű változata (`decisions/0012`).
 *
 * A bemenet a forrásjegyzet törzse, nem az átirat — a futás ezt a `transcript`
 * mezőben adja —, és a rubrika is ahhoz mér. Kártyaforrásnál is prózaként
 * fordít: a kész Markdownt, nem a sémát.
 */
export function translationOf(source: Recipe, target: LanguageTag): Recipe {
  const name = LANGUAGE_NAMES[target]
  return {
    id: `${source.id}-${target}`,
    outputFile: `_${source.id}-${target}.md`,
    publishable: source.publishable,
    role: 'draft',
    maxIterations: 0,
    // A legnagyobb mért kimeneti arány, felfelé kerekítve
    // (docs/measurements/2026-09-17-forditas-kalibralas.md).
    outputRatio: 5.68,
    // A lefordított kártyák is Decks-paklik maradnak.
    tags: source.tags,
    translation: { source, target },

    prompt: ({ item, transcript }) =>
      [
        `Translate the note below into ${name}.`,
        '',
        'Rules:',
        rules(target),
        '',
        `Title: ${item.title}`,
        '',
        '--- NOTE ---',
        transcript,
      ].join('\n'),

    repairPrompt: ({ item, transcript, previous, gaps }) =>
      [
        'Revise the translation below. A reviewer compared it with the source note and',
        'listed concrete gaps. Fix every gap. Keep what already works — do not rewrite',
        'the text wholesale.',
        '',
        'The original rules still apply:',
        rules(target),
        '',
        `Title: ${item.title}`,
        '',
        '--- GAPS TO FIX ---',
        ...gaps.map((gap) => `- ${gap}`),
        '',
        '--- CURRENT TRANSLATION ---',
        previous,
        '',
        '--- SOURCE NOTE ---',
        transcript,
      ].join('\n'),

    rubric: {
      criteria: [
        formatCriterion,
        targetLanguageCriterion(target),
        skeletonCriterionFor({ headingsAreContent: source.headingsAreContent }),
        translationFaithfulness(target),
      ],
      // Egyetlen pontozó kritérium van, tehát a küszöb közvetlenül a bíró
      // ítéletére vonatkozik. A kapuk nem pontoznak, csak átengednek.
      passThreshold: 0.8,
    },
  }
}

/**
 * Ha a forrásjegyzet már a célnyelven van, a kihagyás oka; különben `null`.
 *
 * A nyelvet a jegyzet **szövegéből** azonosítja, nem az elem metaadatából
 * (`0009`, 5. pont): egy magyar feliratból angolul írt összefoglaló lefordul.
 * Bizonytalan azonosításnál nem hagy ki.
 */
export function alreadyInTarget(body: string, target: LanguageTag): string | null {
  return identifyLanguage(body) === target ? `a forrás már ${HUNGARIAN_NAMES[target]}` : null
}
