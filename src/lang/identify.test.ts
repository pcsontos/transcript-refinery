import { describe, expect, it } from 'vitest'
import { identifyLanguage, languageName, LANGUAGE_NAMES } from './identify.js'

/**
 * Minden mintaszöveg **saját írású**. A valós korpusz privát, és egy
 * korpuszrészlet a repóba kerülve kiszivárogtatná.
 */
const ANGOL_JEGYZET = `This video walks through how a service mesh handles traffic between pods.

## What the sidecar does
- Every pod gets a proxy container injected next to the application container.
- The application talks to localhost, and the proxy takes care of retries.
- Because the proxy sees every request, it can report latency without any
  change to the code.

## Why mutual TLS matters here
The speaker argues that the interesting part is not encryption on its own, but
identity. Each workload gets a certificate that names it, so a policy can say
which service is allowed to call which other service. Without that identity, a
network policy can only reason about addresses, and addresses move.`

const HOLLAND_JEGYZET = `Deze video legt uit hoe een service mesh het verkeer tussen pods afhandelt.

## Wat de sidecar doet
- Elke pod krijgt een proxy container naast de applicatie container.
- De applicatie praat met localhost, en de proxy zorgt voor herhalingen.
- Omdat de proxy elk verzoek ziet, kan hij de latentie rapporteren zonder dat
  de code verandert.

## Waarom wederzijdse TLS hier belangrijk is
De spreker stelt dat het interessante deel niet de versleuteling op zichzelf
is, maar de identiteit. Elke werklast krijgt een certificaat dat hem benoemt,
zodat een beleid kan zeggen welke service welke andere service mag aanroepen.`

const MAGYAR_JEGYZET = `Ez a videó azt mutatja be, hogyan kezeli egy service mesh a podok közötti forgalmat.

## Mit csinál a sidecar
- Minden pod mellé bekerül egy proxy konténer az alkalmazás konténere mellé.
- Az alkalmazás a localhosttal beszél, a proxy pedig elintézi az
  újrapróbálkozásokat.
- Mivel a proxy minden kérést lát, jelenteni tudja a késleltetést anélkül,
  hogy a kódhoz hozzá kellene nyúlni.

## Miért fontos itt a kölcsönös TLS
Az előadó szerint nem maga a titkosítás az érdekes, hanem az identitás. Minden
munkaterhelés kap egy tanúsítványt, ami megnevezi őt, így egy szabály ki tudja
mondani, melyik szolgáltatás hívhat meg melyik másikat.`

describe('identifyLanguage — felismerés', () => {
  it('angol jegyzetet angolnak ismer fel', () => {
    expect(identifyLanguage(ANGOL_JEGYZET)).toBe('en')
  })

  it('holland jegyzetet hollandnak ismer fel — ez volt a megfigyelt hiba', () => {
    expect(identifyLanguage(HOLLAND_JEGYZET)).toBe('nl')
  })

  it('magyar jegyzetet magyarnak ismer fel', () => {
    expect(identifyLanguage(MAGYAR_JEGYZET)).toBe('hu')
  })

  it('a kódnehéz kártyalapot is angolnak ismeri fel', () => {
    const kartyak = `## What flag enables the proxy?
\`--sidecar-inject=true\`

## Which port does the proxy listen on?
15001

## What does this command print?
\`kubectl get pods -n istio-system -o wide\`

## What is the default mTLS mode?
PERMISSIVE`
    expect(identifyLanguage(kartyak)).toBe('en')
  })

  it('a szakszavak nem viszik el: magyar kifejezésekkel is angol marad', () => {
    // A tartalmi szavak átszivárognak a nyelvek között, a funkciószavak nem.
    // Ezért mérünk funkciószavakkal.
    const kevert = `The speaker uses the Hungarian term "kubernetes fürt" throughout,
but the notes below are in English. A fürt is simply a cluster, and the
csomópont is a node. Despite these borrowed words, every sentence here follows
English grammar and English function words, so the note should still be
identified as English by any reasonable measure of the text.`
    expect(identifyLanguage(kevert)).toBe('en')
  })
})

describe('identifyLanguage — amikor nem tudja', () => {
  it('profilon kívüli nyelvre nem talál ki ítéletet (lengyel)', () => {
    const lengyel = `Ten film pokazuje, w jaki sposób siatka usług obsługuje ruch
między podami. Każdy pod otrzymuje kontener proxy obok kontenera aplikacji, a
aplikacja rozmawia z localhost. Ponieważ proxy widzi każde żądanie, może
raportować opóźnienia bez zmiany kodu aplikacji.`
    expect(identifyLanguage(lengyel)).toBeNull()
  })

  it('a török mintát az ARÁNY-őr fogja meg, nem a fölény', () => {
    // Fontos eset: itt a futam-második NULLA találat, tehát a fölény
    // végtelen. Ha csak fölényre szűrnénk, a modul magabiztosan angolt
    // mondana egy török szövegre.
    const torok = `Bu video, bir servis ağının podlar arasındaki trafiği nasıl
yönettiğini anlatıyor. Her pod uygulama kabının yanına bir proxy kabı alır ve
uygulama localhost ile konuşur.`
    expect(identifyLanguage(torok)).toBeNull()
  })

  it('nem latin betűs szövegre null', () => {
    expect(
      identifyLanguage(
        'このビデオでは、サービスメッシュがポッド間のトラフィックをどのように処理するかを説明します。',
      ),
    ).toBeNull()
  })

  it('csak kódra null', () => {
    const kod = `\`\`\`yaml
apiVersion: v1
kind: Pod
metadata:
  name: proxy
spec:
  containers:
    - image: envoy:1.29
      ports: [15001, 15006]
\`\`\``
    expect(identifyLanguage(kod)).toBeNull()
  })

  it('a négyszavas angolt a FÖLÉNY-őr fogja meg, nem az arány', () => {
    // Fontos eset: az arány 0,25, bőven a küszöb fölött. Csak a fölény —
    // 1,00× — állítja meg. Ha csak arányra szűrnénk, egy négyszavas mondat
    // érmefeldobással kapna nyelvet.
    expect(identifyLanguage('Pods share a network.')).toBeNull()
  })

  it('üres szövegre null, nem nullával osztás', () => {
    expect(identifyLanguage('')).toBeNull()
    expect(identifyLanguage('   \n\t  ')).toBeNull()
  })
})

describe('languageName', () => {
  it('a fájlnév-utótagból angol nyelvnevet ad', () => {
    expect(languageName('en')).toBe('English')
    expect(languageName('hu')).toBe('Hungarian')
    expect(languageName('nl')).toBe('Dutch')
  })

  it('a régióváltozatot a nyelvre vezeti vissza', () => {
    expect(languageName('en-US')).toBe('English')
    expect(languageName('EN-GB')).toBe('English')
  })

  it('hiányzó vagy ismeretlen tagnál angol az alapértelmezés', () => {
    // Az `item.language` a fájlnév utótagja, ami hiányozhat is. A tartalék
    // szándékos döntés, nem véletlen: lásd `0009`.
    expect(languageName(null)).toBe('English')
    expect(languageName('pt')).toBe('English')
    expect(languageName('')).toBe('English')
  })

  it('minden megnevezhető nyelvhez tartozik név', () => {
    for (const [tag, nev] of Object.entries(LANGUAGE_NAMES)) {
      expect(nev.length).toBeGreaterThan(0)
      expect(languageName(tag)).toBe(nev)
    }
  })
})
