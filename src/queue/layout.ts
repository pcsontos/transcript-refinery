import type { LanguageTag } from '../lang/identify.js'
import type { Registry } from '../recipe/registry.js'

/** Mi kerül egy videó alá: az alapreceptek, és melyik alá milyen nyelvű fordítás. */
export interface QueueLayout {
  /** Az alaprecept-azonosítók, a regiszter sorrendjében. */
  recipes: readonly string[]
  /** Forrásrecept → célnyelv, pl. `clean` → `hu`. */
  translations: ReadonlyMap<string, LanguageTag>
}

/** A sor elrendezése a regiszterből: alaprecept az, aminek nincs `translation` mezője. */
export function queueLayout(registry: Registry): QueueLayout {
  const recipes: string[] = []
  const translations = new Map<string, LanguageTag>()
  for (const recipe of Object.values(registry)) {
    if (recipe.translation) translations.set(recipe.translation.source.id, recipe.translation.target)
    else recipes.push(recipe.id)
  }
  return { recipes, translations }
}

/** A fordítórecept azonosítója: `summary` + `hu` → `summary-hu`. */
export function translationId(source: string, lang: string): string {
  return `${source}-${lang}`
}

/** Egy fordítórecept azonosítójának forrása és nyelve — csak a layoutban szereplőre. */
export function splitTranslationId(
  layout: QueueLayout,
  id: string,
): { source: string; lang: LanguageTag } | null {
  for (const [source, lang] of layout.translations) {
    if (translationId(source, lang) === id) return { source, lang }
  }
  return null
}

/** A nyelvi címke elsődleges altagja kisbetűvel: `hu-HU` → `hu`. Üres címkére `null`. */
export function primaryLanguage(tag: string | null): string | null {
  if (tag === null) return null
  const primary = tag.toLowerCase().split(/[-_]/)[0]!
  return primary === '' ? null : primary
}
