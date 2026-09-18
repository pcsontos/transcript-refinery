/**
 * A vázkapu **publikus, címkézett** halmaza. Szintetikus forrásjegyzetek a négy
 * forrásrecept renderelt alakjában, egy-egy helyes magyar fordítással és
 * szándékosan törött változatokkal. A kapu determinisztikus, de hogy a törött
 * fordítást megfogja-e és a helyeset átengedi-e, azt mérni kell
 * (`evaluation.md` §1).
 */
export type SkeletonRecipe = 'clean' | 'summary' | 'notes' | 'bloom'

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

/** A helyes fordítás egy részének cseréje; a cserélt szövegnek léteznie kell. */
function broken(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error(`a fixture-ben nincs ilyen szöveg: ${from}`)
  return text.replace(from, to)
}

export const SKELETON_LABELS: SkeletonLabel[] = [
  { id: 'clean-helyes', recipe: 'clean', source: CLEAN_SOURCE, translation: CLEAN_HU, label: 'ok' },
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
    recipe: 'clean',
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
    recipe: 'clean',
    source: CLEAN_SOURCE,
    translation: broken(
      CLEAN_HU,
      '## Első kérdés: mit adj el\n\n[00:19] Az első tehát az, hogy mit adj el. Mindenki ugyanúgy kezd bele egy AI-vállalkozásba, és ez teljesen fordított sorrend.\n\n[00:34] 17 évesen kezdtem cégeket építeni, és majdnem egy évtizedig csak buktam.',
      '## Első kérdés: mit adj el [00:19] Az első tehát az, hogy mit adj el. Mindenki ugyanúgy kezd bele egy AI-vállalkozásba, és ez teljesen fordított sorrend. [00:34] 17 évesen kezdtem cégeket építeni, és majdnem egy évtizedig csak buktam.',
    ),
    label: 'broken',
    expected: /has 3 paragraphs, the source has 5/,
  },
  {
    id: 'clean-atirt-idobelyeg',
    recipe: 'clean',
    source: CLEAN_SOURCE,
    translation: broken(CLEAN_HU, '[00:34]', '[00:35]'),
    label: 'broken',
    expected: /Timestamp 3 is \[00:34\] in the source but \[00:35\]/,
  },
  {
    id: 'clean-osszefoglalo',
    recipe: 'clean',
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
]
