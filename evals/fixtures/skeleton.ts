/**
 * A vázkapu **publikus, címkézett** halmaza. Szintetikus forrásjegyzetek a négy
 * forrásrecept renderelt alakjában, egy-egy helyes magyar fordítással és
 * szándékosan törött változatokkal. A kapu determinisztikus, de hogy a törött
 * fordítást megfogja-e és a helyeset átengedi-e, azt mérni kell
 * (`evaluation.md` §1).
 */
import { bloomRecipe } from '../../src/recipe/bloom.js'
import { cleanRecipeFor } from '../../src/recipe/clean.js'
import { notesRecipe } from '../../src/recipe/notes.js'
import { summaryRecipe } from '../../src/recipe/summary.js'
import type { Recipe } from '../../src/recipe/types.js'

export type SkeletonRecipe = 'clean-moderate' | 'summary' | 'notes' | 'bloom'

export interface SkeletonLabel {
  id: string
  recipe: SkeletonRecipe
  source: string
  translation: string
  /** A kézzel adott, mérvadó címke. */
  label: 'ok' | 'broken'
  /** Törött esetnél a hiánynak erre kell illeszkednie: így látszik, melyik vázelem fogta meg. */
  expected?: RegExp
}

const lines = (...rows: string[]): string => rows.join('\n')

const CLEAN_SOURCE = lines(
  '# Introduction',
  '',
  "[00:01] I've built multiple companies starting with nothing but one person and AI. Some of them are already making millions in revenue.",
  '',
  '## Question One: What to Sell',
  '',
  '[00:19] So the first one is: what to sell. Everyone starts an AI business the same way, and that is completely backwards.',
  '',
  '[00:34] I started building companies when I was 17, and I went almost a decade failing.',
)

const CLEAN_HU = lines(
  '# Bevezetés',
  '',
  '[00:01] Több sikeres céget építettem fel úgy, hogy csak egy ember és az AI volt a kezdet. Ezek közül néhány már most is milliós bevételt hoz.',
  '',
  '## Első kérdés: mit adj el',
  '',
  '[00:19] Az első tehát az, hogy mit adj el. Mindenki ugyanúgy kezd bele egy AI-vállalkozásba, és ez teljesen fordított sorrend.',
  '',
  '[00:34] 17 évesen kezdtem cégeket építeni, és majdnem egy évtizedig csak buktam.',
)

const BLOOM_SOURCE = lines(
  '## What does the first question ask?',
  '',
  'It asks what the business should sell.',
  '',
  '**Why:** Starting from the technology instead of the problem is the common mistake.',
  '',
  '*Remember · Beginner*',
  '',
  '## Why is starting from the technology backwards?',
  '',
  'Because a product needs a problem to solve before it needs a tool.',
  '',
  '**Why:** The speaker failed for a decade by building technology first.',
  '',
  '*Understand · Intermediate*',
)

const BLOOM_HU = lines(
  '## Mit kérdez az első kérdés?',
  '',
  'Azt, hogy mit adjon el a vállalkozás.',
  '',
  '**Miért:** A gyakori hiba az, hogy a technológiából indulunk ki, és nem a problémából.',
  '',
  '*Emlékezés · Kezdő*',
  '',
  '## Miért fordított sorrend a technológiából kiindulni?',
  '',
  'Mert egy terméknek előbb egy megoldandó probléma kell, és csak utána egy eszköz.',
  '',
  '**Miért:** A beszélő egy évtizedig bukott, mert előbb a technológiát építette meg.',
  '',
  '*Megértés · Haladó*',
)

const BLOOM_LONG_SOURCE = lines(
  '## What does the first question ask?',
  '',
  'It asks what the business should sell.',
  '',
  '**Why:** Starting from the technology instead of the problem is the common mistake.',
  '',
  '*Remember · Beginner*',
  '',
  '## Why is starting from the technology backwards?',
  '',
  'Because a product needs a problem to solve before it needs a tool.',
  '',
  '**Why:** The speaker failed for a decade by building technology first.',
  '',
  '*Understand · Intermediate*',
  '',
  '## How do you test an idea before building it?',
  '',
  'By delivering the first version by hand to one customer.',
  '',
  '**Why:** Manual delivery shows whether the need is real.',
  '',
  '*Apply · Intermediate*',
  '',
  '## What should you measure in the first month?',
  '',
  'The time it takes a customer to reach the first result.',
  '',
  '**Why:** That number moves every other number.',
  '',
  '*Analyse · Intermediate*',
  '',
  '## What should you ignore?',
  '',
  'Anything that does not move those two numbers.',
  '',
  '**Why:** Attention is the scarcest resource of a one-person business.',
  '',
  '*Evaluate · Advanced*',
  '',
  '## What do you build after validation?',
  '',
  'The smallest solution that delivers the promised result.',
  '',
  '**Why:** Automating early solves the wrong problem.',
  '',
  '*Create · Advanced*',
)

const BLOOM_LONG_HU = lines(
  '## Mit kérdez az első kérdés?',
  '',
  'Azt, hogy mit adjon el a vállalkozás.',
  '',
  '**Miért:** A gyakori hiba az, hogy a technológiából indulunk ki, és nem a problémából.',
  '',
  '*Emlékezés · Kezdő*',
  '',
  '## Miért fordított sorrend a technológiából kiindulni?',
  '',
  'Mert egy terméknek előbb egy megoldandó probléma kell, és csak utána egy eszköz.',
  '',
  '**Miért:** A beszélő egy évtizedig bukott, mert előbb a technológiát építette meg.',
  '',
  '*Megértés · Haladó*',
  '',
  '## Hogyan teszteld az ötletet, mielőtt megépítenéd?',
  '',
  'Úgy, hogy az első változatot kézzel szállítod egyetlen ügyfélnek.',
  '',
  '**Miért:** A kézi szállítás mutatja meg, hogy valódi-e az igény.',
  '',
  '*Alkalmazás · Haladó*',
  '',
  '## Mit mérj az első hónapban?',
  '',
  'Azt az időt, amíg egy ügyfél eljut az első eredményig.',
  '',
  '**Miért:** Ez a szám mozdítja az összes többit.',
  '',
  '*Elemzés · Haladó*',
  '',
  '## Mit hagyj figyelmen kívül?',
  '',
  'Mindent, ami nem mozdítja ezt a két számot.',
  '',
  '**Miért:** A figyelem a legszűkebb erőforrás egy egyszemélyes vállalkozásban.',
  '',
  '*Értékelés · Haladó*',
  '',
  '## Mit építs a validálás után?',
  '',
  'A legkisebb megoldást, amely az ígért eredményt adja.',
  '',
  '**Miért:** A korai automatizálás rossz problémát old meg.',
  '',
  '*Alkotás · Haladó*',
)

const NOTES_SOURCE = lines(
  '## Overview',
  '',
  '```mermaid',
  'flowchart LR',
  '  A[Idea] --> B[Problem]',
  '```',
  '',
  '## Key Concepts',
  '',
  '### Problem first',
  '',
  'Start from a problem, not from a tool.',
  '',
  '**Example:** A founder interviews ten customers before writing code.',
  '',
  '**Variation:** A team rewrites a feature after users reject it.',
  '',
  '## Summary Table',
  '',
  '| Term | Definition | Example |',
  '| --- | --- | --- |',
  '| Problem first | Start from a problem | Ten interviews |',
)

const NOTES_HU = lines(
  '## Áttekintés',
  '',
  '```mermaid',
  'flowchart LR',
  '  A[Ötlet] --> B[Probléma]',
  '```',
  '',
  '## Kulcsfogalmak',
  '',
  '### Előbb a probléma',
  '',
  'A problémából indulj ki, és ne egy eszközből, mert az csak utána jön.',
  '',
  '**Példa:** Egy alapító tíz ügyféllel is beszél, mielőtt egy sor kódot írna.',
  '',
  '**Variáció:** Egy csapat újraír egy funkciót, miután a felhasználók nem fogadják el.',
  '',
  '## Összefoglaló táblázat',
  '',
  '| Fogalom | Meghatározás | Példa |',
  '| --- | --- | --- |',
  '| Előbb a probléma | A problémából indulj ki | Tíz interjú |',
)

const SUMMARY_SOURCE = lines(
  'Dan Martell explains three questions to ask before starting a one-person business.',
  '',
  '## What to sell',
  '',
  '- Start from a problem, not from the technology.',
  '- Test the idea before building it.',
  '',
  '## Sources',
  '',
  '- [Buy Back Your Time](<https://bit.ly/3pCTG78>)',
)

const SUMMARY_HU = lines(
  'Dan Martell három kérdést mutat be, amelyeket egy egyszemélyes vállalkozás indítása előtt érdemes feltenni.',
  '',
  '## Mit adj el',
  '',
  '- A problémából indulj ki, és ne a technológiából.',
  '- Ez az 1. lépés: teszteld az ötletet, mielőtt megépíted.',
  '',
  '## Források',
  '',
  '- [Vásárold vissza az idődet](<https://bit.ly/3pCTG78>)',
)

const SUMMARY_LONG_SOURCE = lines(
  'Dan Martell explains how a one-person business finds its first offer.',
  '',
  '## What to sell',
  '',
  'Start from a problem you have already solved for someone else.',
  '',
  '## Who to sell it to',
  '',
  '- People who have the problem today.',
  '- People who can pay for a solution.',
  '',
  '## How to price it',
  '',
  'Price the outcome, not the hours you spend on it.',
  '',
  '## How to deliver it',
  '',
  'Deliver the first version by hand, before you automate anything.',
  '',
  '## What to measure',
  '',
  '- Time to first result.',
  '- Number of customers who renew.',
  '',
  '## What to ignore',
  '',
  'Ignore anything that does not move those two numbers.',
)

const SUMMARY_LONG_HU = lines(
  'Dan Martell elmondja, hogyan találja meg egy egyszemélyes vállalkozás az első ajánlatát.',
  '',
  '## Mit adj el',
  '',
  'Olyan problémából indulj ki, amelyet már megoldottál valaki másnak.',
  '',
  '## Kinek add el',
  '',
  '- Azoknak, akiknek ma is megvan ez a problémájuk.',
  '- Azoknak, akik fizetni is tudnak a megoldásért.',
  '',
  '## Hogyan árazd',
  '',
  'Az eredményt árazd, és ne az órákat, amelyeket ráfordítasz.',
  '',
  '## Hogyan szállítsd',
  '',
  'Az első változatot kézzel szállítsd, mielőtt bármit automatizálnál.',
  '',
  '## Mit mérj',
  '',
  '- Az első eredményig eltelt időt.',
  '- Azoknak az ügyfeleknek a számát, akik meghosszabbítják.',
  '',
  '## Mit hagyj figyelmen kívül',
  '',
  'Hagyj figyelmen kívül mindent, ami nem mozdítja ezt a két számot.',
)

/** A helyes fordítás egy részének cseréje; a cserélt szövegnek léteznie kell. */
function broken(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error(`a fixture-ben nincs ilyen szöveg: ${from}`)
  return text.replace(from, to)
}

/**
 * A címkézett eset receptneve és a valódi recept. A vázkapu szigora a
 * receptből jön (`Recipe.headingsAreContent`), ezért a mérés és az eval is
 * innen veszi.
 */
export const SKELETON_SOURCE_RECIPES: Record<SkeletonRecipe, Recipe> = {
  'clean-moderate': cleanRecipeFor('moderate'),
  summary: summaryRecipe,
  notes: notesRecipe,
  bloom: bloomRecipe,
}

export const SKELETON_LABELS: SkeletonLabel[] = [
  { id: 'clean-helyes', recipe: 'clean-moderate', source: CLEAN_SOURCE, translation: CLEAN_HU, label: 'ok' },
  { id: 'bloom-helyes', recipe: 'bloom', source: BLOOM_SOURCE, translation: BLOOM_HU, label: 'ok' },
  { id: 'notes-helyes', recipe: 'notes', source: NOTES_SOURCE, translation: NOTES_HU, label: 'ok' },
  {
    id: 'summary-helyes',
    recipe: 'summary',
    source: SUMMARY_SOURCE,
    translation: SUMMARY_HU,
    label: 'ok',
  },
  {
    id: 'clean-kimaradt-bekezdes',
    recipe: 'clean-moderate',
    source: CLEAN_SOURCE,
    translation: broken(
      CLEAN_HU,
      '\n\n[00:34] 17 évesen kezdtem cégeket építeni, és majdnem egy évtizedig csak buktam.',
      '',
    ),
    label: 'broken',
    expected: /has 2 timestamps, the source has 3; the first difference follows \[00:19\]/,
  },
  {
    id: 'clean-osszevont-bekezdes',
    recipe: 'clean-moderate',
    source: CLEAN_SOURCE,
    translation: broken(CLEAN_HU, 'sorrend.\n\n[00:34] 17', 'sorrend. 17'),
    label: 'broken',
    expected: /has 2 timestamps, the source has 3; the first difference follows \[00:19\]/,
  },
  {
    id: 'clean-atirt-idobelyeg',
    recipe: 'clean-moderate',
    source: CLEAN_SOURCE,
    translation: broken(CLEAN_HU, '[00:34]', '[00:35]'),
    label: 'broken',
    expected: /Timestamp 3 is \[00:34\] in the source but \[00:35\]/,
  },
  {
    id: 'clean-osszefoglalo',
    recipe: 'clean-moderate',
    source: CLEAN_SOURCE,
    translation:
      '[00:01] A beszélő elmondja, hogy egy ember és az AI is elég egy céghez, de előbb azt kell eldönteni, mit adsz el.',
    label: 'broken',
    expected: /has 0 headings, the source has 2/,
  },
  {
    id: 'bloom-kimaradt-kartya',
    recipe: 'bloom',
    source: BLOOM_SOURCE,
    translation: broken(
      BLOOM_HU,
      '\n\n## Miért fordított sorrend a technológiából kiindulni?\n\nMert egy terméknek előbb egy megoldandó probléma kell, és csak utána egy eszköz.\n\n**Miért:** A beszélő egy évtizedig bukott, mert előbb a technológiát építette meg.\n\n*Megértés · Haladó*',
      '',
    ),
    label: 'broken',
    expected: /has 1 headings, the source has 2/,
  },
  {
    id: 'bloom-cimkebol-fejlec',
    recipe: 'bloom',
    source: BLOOM_SOURCE,
    translation: broken(BLOOM_HU, '**Miért:** A gyakori hiba', '## Miért: A gyakori hiba'),
    label: 'broken',
    expected: /has 3 headings, the source has 2/,
  },
  {
    id: 'notes-kimaradt-tablazatsor',
    recipe: 'notes',
    source: NOTES_SOURCE,
    translation: broken(NOTES_HU, '\n| Előbb a probléma | A problémából indulj ki | Tíz interjú |', ''),
    label: 'broken',
    expected: /has 2 table rows, the source has 3/,
  },
  {
    id: 'notes-elveszett-mermaid-jelolo',
    recipe: 'notes',
    source: NOTES_SOURCE,
    translation: broken(NOTES_HU, '```mermaid', '```'),
    label: 'broken',
    expected: /Code block 1 is marked `mermaid` in the source but `plain`/,
  },
  {
    id: 'summary-kimaradt-listaelem',
    recipe: 'summary',
    source: SUMMARY_SOURCE,
    translation: broken(SUMMARY_HU, '\n- Ez az 1. lépés: teszteld az ötletet, mielőtt megépíted.', ''),
    label: 'broken',
    expected: /has 2 list items, the source has 3/,
  },
  {
    id: 'summary-atirt-linkcel',
    recipe: 'summary',
    source: SUMMARY_SOURCE,
    translation: broken(SUMMARY_HU, 'https://bit.ly/3pCTG78', 'https://bit.ly/masik'),
    label: 'broken',
    expected: /A link target changed: <https:\/\/bit\.ly\/3pCTG78> is missing/,
  },
  {
    id: 'summary-tobblet-fejlec',
    recipe: 'summary',
    source: SUMMARY_LONG_SOURCE,
    // A kalibrálás mért hibamódja: a fordítás egy bekezdésből fejlécet csinál
    // (6 → 7 fejléc), minden tartalom megmarad.
    translation: broken(
      SUMMARY_LONG_HU,
      'Az eredményt árazd, és ne az órákat, amelyeket ráfordítasz.',
      '### Az eredményt árazd, és ne az órákat',
    ),
    label: 'ok',
  },
  {
    id: 'notes-bekezdesbontas',
    recipe: 'notes',
    source: NOTES_SOURCE,
    // Egy hosszú bekezdés kettébomlik (9 → 10 blokk), tartalomvesztés nélkül.
    translation: broken(
      NOTES_HU,
      'A problémából indulj ki, és ne egy eszközből, mert az csak utána jön.',
      'A problémából indulj ki.\n\nEgy eszköz csak ezután jön.',
    ),
    label: 'ok',
  },
  {
    id: 'summary-kimaradt-bekezdesek',
    recipe: 'summary',
    source: SUMMARY_LONG_SOURCE,
    translation: broken(
      broken(
        SUMMARY_LONG_HU,
        '\n\nOlyan problémából indulj ki, amelyet már megoldottál valaki másnak.',
        '',
      ),
      '\n\nAz első változatot kézzel szállítsd, mielőtt bármit automatizálnál.',
      '',
    ),
    label: 'broken',
    expected: /has 11 paragraphs, the source has 13/,
  },
  {
    id: 'bloom-cimkebol-fejlec-hosszu',
    recipe: 'bloom',
    source: BLOOM_LONG_SOURCE,
    // Hat kártya mellett a fejléc-tűrés 1, tehát ezt a torzulást KIZÁRÓLAG a
    // `headingsAreContent` szigor fogja meg: a blokkszám nem változik.
    translation: broken(
      BLOOM_LONG_HU,
      '**Miért:** A gyakori hiba az, hogy a technológiából indulunk ki, és nem a problémából.',
      '## Miért: a gyakori hiba a technológiából kiindulni',
    ),
    label: 'broken',
    expected: /has 7 headings, the source has 6/,
  },
]
