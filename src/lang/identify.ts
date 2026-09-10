/**
 * Nyelvazonosítás funkciószavakból — determinisztikus, nulla token, nulla
 * függőség.
 *
 * A módszer azon áll, hogy a funkciószavak (névelő, kötőszó, névmás,
 * elöljáró) minden nyelvben a szöveg nagy részét kiteszik, és nyelvenként
 * mások. A **tartalmi** szavak — amik szakszövegben át is szivárognak más
 * nyelvekből — így nem torzítanak.
 *
 * A modul **nem találgat**: ha nem elég erős a jel, `null`-t ad. A hívó ezt
 * átengedésnek veszi (`rubric/language.ts`), mert egy téves ítélet egy
 * helyes jegyzetet buktatna meg.
 */

/** A megnevezhető nyelvek és angol nevük. A prompt ezt a nevet mondja ki. */
export const LANGUAGE_NAMES = {
  en: 'English',
  hu: 'Hungarian',
  nl: 'Dutch',
  de: 'German',
  es: 'Spanish',
  fr: 'French',
  it: 'Italian',
} as const

export type LanguageTag = keyof typeof LANGUAGE_NAMES

/**
 * Nyelvenként 50–80 funkciószó. A holland azért van a listán, mert a
 * megfigyelt hiba pontosan az volt (`0009`).
 *
 * A listák a valós korpuszon mérve lettek kiválasztva, nem elméletből: lásd
 * a spec „Amit a küszöbök megválasztása előtt megmértünk" szakaszát.
 */
const PROFILES: Record<LanguageTag, string> = {
  en: 'the of and to a in is it that you i we they he she for on with as at by this but not are was be have has had do does did from or an if then there their our your my me him her them what which who when where how all can will would should could about into over after before more most other some such no nor only own same so than too very just',
  hu: 'a az és hogy nem is de vagy egy mint már csak ez ezt ezek akkor ha van volt lesz lehet kell meg el ki be fel le át rá ide oda itt ott így úgy amikor ahol aki ami amit annak ennek mert hiszen tehát pedig azonban viszont szerint között alatt fölött után előtt nélkül miatt által vagyok vagyunk vannak voltam nagyon még sem se minden semmi valami',
  nl: 'de het een en van is in dat op te zijn met voor niet aan er maar om die als dan ook nog wel naar door over bij uit al kan zou moet heeft hebben was werd worden deze dit hun onze jouw mijn wat welke wie waar hoe alle veel meer heel zo want dus echter tussen onder boven na zonder omdat wordt hij zij ze we ik jij',
  de: 'der die das und ist in den von zu mit sich auf für nicht ein eine als auch es an werden aus er hat dass sie nach bei um noch wie über nur oder aber vor durch man sein wurde sind einem einen einer dem des im am zum zur kann muss soll wenn dann weil damit zwischen unter ohne gegen schon immer sehr',
  es: 'el la de que y en los las un una por con no se para es al del lo como más pero sus le ya o este sí porque esta entre cuando muy sin sobre también me hasta hay donde han quien está desde todo nos durante todos uno les ni contra otros ese eso',
  fr: 'le la de et les des en un une du dans il que pour qui sur ne pas ce se au plus par avec son sont mais ou où comme sa tout nous vous ils elle été être avoir fait cette ces leur bien sans peut aussi deux même y a je te lui dont',
  it: 'il di che la e un per non in una sono con si le da mi ha ma come lo se ci hai ho perché cosa quando anche questo tutto della dei alla nel sul più molto quindi però tra sotto sopra dopo prima senza essere avere fare',
}

const SETS = Object.entries(PROFILES).map(
  ([tag, list]) => [tag as LanguageTag, new Set(list.split(' '))] as const,
)

/**
 * Minimális találati arány. A valós korpuszon a leggyengébb angol átirat
 * 0,410-et, a leggyengébb jegyzet alakú minta 0,343-at ért el; a profilon
 * kívüli nyelvek 0,027 és 0,040 között maradtak. A 0,15 e két tartomány
 * között áll, mindkét irányban tartalékkal.
 */
const MIN_RATE = 0.15

/**
 * Minimális fölény a futam-második fölött. A leggyengébb valódi találat
 * 2,50×-et hozott; a kiegyenlített hamis jelöltek 1,00×-en állnak.
 */
const MIN_MARGIN = 1.5

/** Szavakra bontás: minden, ami nem betű, elválasztó. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((w) => w !== '')
}

/**
 * A szöveg nyelve, vagy `null`, ha a jel nem elég erős.
 *
 * **A két őr külön eseteket fog meg, ezért egyik sem elhagyható.** Egy török
 * szövegen a futam-második nulla találat, tehát a fölény végtelen — ott csak
 * az arányőr állít meg. Egy négyszavas angol mondaton az arány 0,25, bőven a
 * küszöb fölött — ott csak a fölényőr állít meg.
 */
export function identifyLanguage(text: string): LanguageTag | null {
  const tokens = words(text)
  if (tokens.length === 0) return null

  const rates = SETS.map(([tag, set]): [LanguageTag, number] => [
    tag,
    tokens.filter((w) => set.has(w)).length / tokens.length,
  ])
  rates.sort((a, b) => b[1] - a[1])

  const [topTag, topRate] = rates[0]!
  const second = rates[1]?.[1] ?? 0

  if (topRate < MIN_RATE) return null
  // Nulla futam-második mellett a fölény végtelen; ilyenkor az arányőr az
  // egyetlen kapu, és az már lefutott.
  if (second > 0 && topRate / second < MIN_MARGIN) return null
  return topTag
}

/**
 * Nyelvi tag → angol név a promptnak.
 *
 * Az `item.language` a feliratfájl nevének utótagja (`en`, `en-US`), ami
 * hiányozhat is. Ismeretlen vagy hiányzó tagnál az alapértelmezés
 * **English** — a döntés indoklása a `0009`-ben.
 */
export function languageName(tag: string | null): string {
  if (tag === null) return LANGUAGE_NAMES.en
  const base = tag.toLowerCase().split('-')[0]!
  return LANGUAGE_NAMES[base as LanguageTag] ?? LANGUAGE_NAMES.en
}
