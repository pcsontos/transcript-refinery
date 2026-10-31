# Spec — LLM-es MDX-átalakítás: webes olvasásra tagolt jegyzetek a showroomon

**Dátum:** 2026-10-30 · **Státusz:** tervezet

Ez a dokumentum a #278 tervezéséből készült. A jegy leírása az alap; ahol ez a spec eltér tőle vagy pontosítja, ez érvényes. A #277 (`refinery deploy`, `docs/plans/2026-10-24-refinery-deploy-spec.md`) döntései változatlanok; ez a spec az ott nyitva hagyott csatlakozási pontot (`Transform`, `src/deploy/deploy.ts`) tölti ki.

## A cél egy mondatban

A showroomon a jegyzet ne egybefüggő, hosszú bekezdésekből álló szöveg legyen, hanem webes olvasásra tagolt oldal: rövid bevezető blokk elöl, szakaszcímek, rövid bekezdések, kiemelt kulcsmondatok, ahol illik komponensek — úgy, hogy az eredeti szöveg egyetlen szava sem változik és nem vész el.

## Miért

- A felhasználó szavaival: „a hosszú bekezdések, nincs tagolás, nehéz olvasni". Átfutva is ki akarja szúrni a lényeges mondatokat, mert ki vannak emelve.
- Minta (a felhasználó adta): <https://ai-engineering.peteroncode.dev/en/ai-engineering/understanding-foundation-models/ch02-1-training-data>. Ott: sok H2-szakasz (11), szakaszonként 2–5 bekezdés, a bekezdések jellemzően 1–3 mondatosak (legfeljebb ~5), rövid „címke + magyarázat" párok, néhol kérdéssel induló szakasz, ritka félkövér (inkább tényekre, számokra), dőlt kifejezések. A mintától egy ponton eltérünk: **elöl van egy rövid bevezető blokk** (felhasználói döntés, 2026-10-30).
- Ma minden kint lévő oldal a determinisztikus változat (`mdx_fallback: true`): a vault-törzs escape-elve, tagolás nélkül.

## Anti-cél (amitől a felhasználó „elhúzza a száját")

**Ha az átalakítás átfogalmaz vagy kihagy valamit a tartalomból.** Ez a legfontosabb szabály; az ellenőrzés (lent) erre épül, és inkább marad a determinisztikus változat, mint hogy egy átfogalmazott oldal kikerüljön.

## A tervezés során hozott döntések

| kérdés | döntés | ok |
|---|---|---|
| Összefoglaló elöl? | **Igen, rövid bevezető blokk** a tetején („miről szól / mit viszel el belőle") | Felhasználói döntés, 2026-10-30 |
| Honnan a bevezető? | **Az átalakító írja**, az adott oldal szövegéből, rövidebben, mint a `summary` recept | Felhasználói döntés, 2026-10-30. A `summary` jegyzet nem kerül bele |
| Átfogalmazhat-e? | **Nem.** Az eredeti szöveg minden szava marad, ugyanabban a sorrendben | Felhasználói döntés, 2026-10-30 |
| Mi kap LLM-et? | `clean-*` (mild/moderate/deep), `summary`, `notes`, **nyelvi változatonként külön** (a fordítások is) | Felhasználói döntés, 2026-10-30 (ma kint: 80 + 76 + 32 ≈ 188 oldal) |
| Mi kap kódból komponenst? | `flashcards`, `qa`, `bloom` — LLM nélkül, determinisztikusan | #278 leírás, felhasználói megerősítés 2026-10-30 |
| Mi marad a mostani formában? | `glossary` | Szójegyzék, nincs mit tagolni (felhasználói megerősítés, 2026-10-30) |
| Linkek új ablakban | **Nem a #278 része.** A showroom `components/mdx.tsx` `a`-felülírásában: külső link `target="_blank" rel="noopener noreferrer"`, belső (horgony, más jegyzet) marad | A szerződés nem enged nyers `<a>`-t; egy helyen, minden oldalra érvényes. Külön showroom-issue: pcsontos/refinery-showroom#84 (felhasználói jóváhagyás, 2026-10-30) |
| Elágazás helye | A fajta szerinti út a deployban dől el, nem az átalakítóban; a kódos (`flashcards`, `qa`, `bloom`) és a `glossary` út LLM-kulcs nélkül is végleges oldalt ad | Felhasználói jóváhagyás, 2026-10-30 (a terv javaslata): a kártyák bontásához nem kell modell |
| `%%…%%` sorok a kártyákban | A kódos út elhagyja (Obsidian-komment, a Decks kártya-azonosítója, pl. `%%dk:h:iil57r%%`) | Felhasználói jóváhagyás, 2026-10-30: a site-on látható szemét lenne |
| Bevezető hosszú törzsnél | Külön bevezető-hívás a teljes szövegből; a darabok bevezető nélkül mennek | Felhasználói döntés, 2026-10-30: az első darabból írt bevezető csak az oldal elejét foglalná össze |
| Modellhívás hibája | Ugyanúgy bukás, mint a kétszer elbukott ellenőrzés: fallback + `mdx_failed` | Felhasználói jóváhagyás, 2026-10-30 (ponytail-review): egy ág kevesebb, az újrapróbát a `--retry-failed` adja |
| Komponenslista | Futáskor a showroom-klón `contract/mdx-components.json`-jából, a promptba is | #278 leírás; a #277 ugyanezt a fájlt olvassa már (`deploy.ts`) |

## A működés

### Hol fut

A #277 `Transform` csatlakozási pontján (`src/deploy/deploy.ts`): a deploy minden kiírandó jelöltre meghívja, a kimenetet `renderMdx`-szel frontmatter mögé teszi, és a meglévő `check` (frontmatter + `mdxErrors`) ellenőrzi. Ha a transform dob vagy a kimenet elbukik, ma is a determinisztikus változat íródik ki `mdx_fallback: true`-val — ez a viselkedés marad. Új: a sikeres LLM-kimenet **nem** kap `mdx_fallback`-ot, így a következő deploy nem alakítja újra.

A deploy mindhárom útja kapja az átalakítót: `refinery deploy` (CLI), a `run` `auto` deployja és a `serve` `auto` deployja.

- A `Transform` aláírása bővülhet (az én döntésem): kell neki a site-fajta, vissza kell adnia a használatot (token, költség) és azt, hogy a kimenet végleges-e vagy fallback. A #277 *döntései* maradnak, az aláírás nem kőbe vésett.
- Ha a modell-config vagy a `LITELLM_API_KEY` hiányzik, a deploy átalakító nélkül fut, és ezt egy sorban jelzi (az én döntésem). Ilyenkor csak az LLM-út marad a mai fallbacknál; a kódos és a `glossary` út átalakító nélkül is végleges (felhasználói jóváhagyás, 2026-10-30). Nem bukik el: a deploy LLM nélkül is hasznos.
- **A `serve` `auto` deployja a „kész" Telegram-válasz után fut**, nem előtte (felhasználói döntés, 2026-10-30). A válasz így nem vár a percekig tartó átalakításra; a site-link addig 404-et adhat, ami a #279 óta elfogadott. Ehhez a `src/serve/summary.ts` mostani sorrendje (és a mellette álló komment) megfordul.

Fajta szerinti elágazás a deployban (a site-fajta a `variantOf` eredményéből jön; felhasználói jóváhagyás, 2026-10-30 — az eredeti terv az átalakítón belülre tette):

- `clean-*`, `summary`, `notes` → LLM-út (lent);
- `flashcards`, `qa`, `bloom` → kódos út (lent);
- `glossary` és minden más → a mostani determinisztikus út.

**A kódos és a `glossary` út kimenete is „nem fallback"** (az én döntésem): ezek végleges formák, különben minden deploy újra és újra átalakítaná őket.

### Az LLM-út szabályai (a prompt tartalma)

1. **Az eredeti szöveg minden szava marad, ugyanabban a sorrendben.** Nincs átfogalmazás, rövidítés, összevonás, kihagyás, új mondat a törzsben.
2. **Hozzáadni csak szerkezetet szabad:** `##`/`###` címek, bekezdéshatár (hosszú bekezdés bontása), félkövér és dőlt kiemelés, felsorolássá vagy `<Steps>`-szé alakítás (ha a szöveg eleve felsorolás vagy lépéssor), komponens-címek (`<Callout title="…">`, `<Card title="…">`, `<Accordion title="…">`, `<Tab title="…">`).
3. **Elöl egy rövid bevezető blokk** az oldal saját nyelvén — ez az egyetlen hely, ahol új mondatok állhatnak. Alakja (az én döntésem): az első felső szintű elem egy `<Callout type="note" title="…">`, a cím nyelvenként rögzített szó (pl. hu „Röviden", en „In brief"; a pontos szót a terv rögzíti). Hossza néhány mondat vagy 3–5 pont.
4. **Komponensek csak ott, ahol a szöveg kínálja**, nem kötelezően minden oldalon. Csak a `contract/mdx-components.json` komponensei és attribútumértékei, string-literál értékkel, `import`/`export` és `{…}` kifejezés nélkül. A komponenslista a fájlból kerül a promptba, nem kézi másolatból.
5. Kiemelés mértékkel: szakaszonként néhány kulcsmondat vagy tény, nem minden második mondat (a minta stílusa).
6. A kimenet érvényes MDX: a szövegbeli `{`, `}`, `<` escape-elve, kódblokkok érintetlenül.
7. A vault-törzs fejléce (`# Cím` és a `🌐 [url](<url>)` sor) változatlanul marad elöl, a bevezető blokk utána jön. Hogy ezt a kód teszi vissza (a modell csak a fejléc utáni részt kapja), vagy a modell őrzi, a tervre bízott (lásd „Ami a tervre marad").

A prompt a `aieng-book-to-web` skill (`~/gitlab/peteroncode/peteroncode.dev/ai-engineering/.agents/skills/aieng-book-to-web/SKILL.md`) szabályaiból indul, a komponenstérkép Docus MDC-ről Fumadocs MDX-re fordítva, és a fenti 1–2. ponttal szigorítva.

### Szó szerinti ellenőrzés (kódból, minden LLM-kimenetre)

Ez az anti-cél kapuja; a fordíthatóság és a #277 komponens-ellenőrzése mellett fut, írás előtt.

A `notes` és a `summary` törzsében már vannak címek, félkövér címkék (`**Example:**`), listák és kódblokkok (mermaid), ezért a megtisztítás **mindkét oldalon** ugyanaz, és a meglévő szerkezet szövege is védett (az én döntéseim):

1. **Csak a kimenetből** hagyandó el: a bevezető blokk (az első, rögzített című `<Callout>`), a komponenscímkék és minden attribútumuk (a `title` is), valamint azok a címsor-sorok, amelyeknek a szövege nem egy eredeti címsor szövege és nem is egy eredeti sor eleji félkövér szöveg (vagyis az új címek). A sor eleji félkövér bevezető (`**Cím.** Szöveg`) címmé emelhető; felhasználói döntés, 2026-10-30, az első `clean-deep` mérés után (a modell ezt rendszeresen megteszi).
2. **Mindkét oldalon** elhagyandó: a Markdown-jelölők (`#`-ok, `**`, `*`, `_`, listajel, számozás, `>`), az escape-jelek. A meglévő címek *szövege* így szóként marad mindkét oldalon: az eredeti cím nem tűnhet el és nem fogalmazható át, de a szintje változhat.
3. Kódblokk tartalma szóközre normalizálva, egy egységként kerül a sorozatba, változatlanul kell maradnia. Linknél a szöveg és az URL is szóként számít (a 🌐 sor is).
4. Mindkét oldalon: Unicode-normalizálás (NFC), írásjelek levágása, szavakra bontás szóközök mentén.
5. **A két sorozatnak egyeznie kell.** Hiányzó, többlet, más vagy átrendezett szó → bukás, az első eltérés helyével a deploy-jelentésben.
6. A bevezető blokknak léteznie kell és nem lehet üres.

Kis- és nagybetű: **érzékeny** az összevetés (az én döntésem; a kiemelés és a tagolás nem igényli a nagybetű megváltoztatását). Ha a próbamérés azt mutatja, hogy a modell rendszeresen nagybetűsít listaelem elején, a terv ezt mérés alapján lazíthatja — csak a betűméretre, a szóra nem.

Bukás után **egy újrapróba** ugyanazzal a prompttal, a hiba leírásával kiegészítve; ha az is elbukik, a mostani visszaesés: determinisztikus változat, `mdx_fallback: true`, kihagyási ok a jelentésben.

**A bukás megjegyzése** (felhasználói döntés, 2026-10-30): a fallback-oldal frontmatterébe `mdx_failed: <generated_at>` kerül. A deploy az ilyen oldalt **nem** küldi újra az LLM-nek, amíg a jegyzet `generated_at`-je ugyanaz; ha a jegyzet változik, újra próbál. Szándékos újrapróbát egy kapcsoló ad a kézi deploynak (az én javaslatom: `refinery deploy --retry-failed`). A modellhívás dobott hibája (pl. `finish_reason: length`) ugyanígy bukás, `mdx_failed`-del (felhasználói jóváhagyás, 2026-10-30). Ez szűkíti a #277 újra-átalakítási feltételét (`mdx_fallback === true && transform !== undefined`). A költségplafon miatt kimaradt oldal (lent) nem kap `mdx_failed`-et, mert nem bukott el.

A `mdx_failed` a site sémájában ismeretlen mező; a terv ellenőrzi, hogy a site buildje átengedi-e (a `mdx_fallback` ugyanígy megy ki ma), és ha nem, a showroomban kell felvenni.

### Hosszú törzsek

A `clean-deep` leiratok kimenete közel akkora, mint a bemenet; egy hívásban kimeneti limitbe vagy időtúllépésbe futhat (vö. #258, #259). Ezért a hosszú törzs **darabokban** megy (az én döntésem): bekezdéshatáron vágva, darabonként külön hívás, a darabok kimenete összefűzve; a darabok bevezető nélkül mennek, a bevezetőt egy külön hívás írja a teljes szövegből (felhasználói döntés, 2026-10-30); egy darabnál ugyanaz a hívás írja. A darabméret mérésből jön, a fordítás `chunk_words`-mintájára (`docs/plans/2026-10-23-fordites-darabolas.md`); a darabolót a terv a `src/recipe/translate-chunks.ts`-ből veszi át, ha illik. Az ellenőrzés a teljes, összefűzött kimenetre fut.

### A kódos út (`flashcards`, `qa`, `bloom`)

A vault-törzs már renderelt Markdown, nem JSON; a kódos út ezt bontja:

- `flashcards`, `bloom`: `## Kérdés` + válasz (bloomnál a `**Why:**` és a `*Szint · Nehézség*` sor is a válaszhoz tartozik);
- `qa`: `**Kérdés**` bekezdés + válasz-bekezdések.

A minták a kint lévő oldalakról (`1BApLicRt1w/flashcards.en.mdx`, `3IetFvFg2cE/qa.hu.mdx`, `4jc30vX7v08/bloom.hu.mdx` a showroom `content/notes` alatt) megfelelnek ennek. A fordított változatok címkéit (`**Why:**` stb.) és a többbekezdéses válaszokat a terv a renderelőkből (`src/recipe/flashcards.ts`, `qa.ts`, `bloom.ts`) és egy fordított mintából ellenőrzi.

Kimenet: a fejléc (cím + 🌐 sor) után egy `<Accordions type="multiple">`, kérdésenként egy `<Accordion title="kérdés">` a válasszal. Ugyanarra a bemenetre bájtra ugyanaz a kimenet. Az attribútumba kerülő kérdésszöveg idézőjelét és egyéb, attribútumban nem engedett jelét a kód kezeli úgy, hogy a `mdxErrors` átengedje (a módot a terv próbával rögzíti). Ha a törzs nem bontható a várt alakra, a determinisztikus út marad `mdx_fallback: true`-val és `mdx_failed`-del. A `%%…%%` sorokat (Obsidian-komment, a Decks kártya-azonosítója) a kódos út elhagyja (felhasználói jóváhagyás, 2026-10-30).

### Modell, költség

- **Modell configból**, külön kulccsal, hogy a draft modelltől függetlenül állítható legyen (az én döntésem: `model.recipes.mdx`; az `assertRecipeModels` ma minden registryn kívüli kulcsot elutasít, ezért a hívás helyén (`cli.ts`) az `mdx` külön ismert azonosítóként kerül a listára). Alapértelmezés hiányában a `draft`. A spike Sonnet 5.5-tel futott; sémás kimenet nem kell, így a #78/#79 és a Gemini-korlát nem érinti.
- **Költség:** a deploy-jelentés (`deployLines`) egy sorban kiírja az átalakítás tokenjeit és költségét (a meglévő árazás modellnév szerint). Run-állapotba nem kerül (a deploy nem run).
- **Költségplafon** (felhasználói döntés, 2026-10-30): a deploy futásonként tartja a `cost_limit_usd`-t (ma 5,00 $), a `run` költségőrének (`createCostGuard`) mintájára. Ha eléri, további LLM-hívás nincs: a maradék oldal ebben a futásban a determinisztikus változat (vagy ami már kint van, az marad), a jelentés kiírja, hány oldal maradt ki a plafon miatt. A következő `refinery deploy` folytatja. A `serve`/`run` `auto` útja ugyanígy.
- **Újrapróbálás:** a meglévő modellkliens hálózati újrapróbája + a fenti egy tartalmi újrapróba.

### Az első, teljes átalakítás (backfill)

A #277 szerint a `mdx_fallback`-os oldalakat a deploy magától újra átalakítja, ha van átalakító. A kézi `refinery deploy` ezért az első futáskor ~188 oldalt küld LLM-en át. Becslés (nem mért): **10–30 $** Sonnet 5.5-tel. Valódi pénzt költ, ezért a teljes kör előtt:

1. próba a két elfogadási jegyzeten, majd egy mintán (pl. 3 `clean-deep`, a leghosszabbak közül), a valós költség és a bukási arány mérésével;
2. a teljes kör a mért költség 2×-es ráhagyásával becsülve, a felhasználó jóváhagyásával indul;
3. a deploy tételenként commitol, így megszakítás után folytatható (a már átalakított oldal nem fallback, nem fut újra);
4. a költségplafon miatt a backfill magától 5 $-os adagokban megy: minden `refinery deploy` egy adag, köztük ellenőrizhető a site és a jelentés.

Hogy a próba hogyan szűkíthető néhány tételre (pl. tétel-azonosító a kézi deploynak), a tervre marad; új kapcsoló csak akkor, ha a meglévő utak (`itemIds`) nem elégségesek.

## Ami a tervre marad (a builder dönti)

- A fejléc kezelése (kód teszi vissza vagy a modell őrzi), a bevezető rögzített címszava nyelvenként.
- A darabméret és a darabolás pontos módja (mérésből).
- A kérdésszöveg attribútumba írásának módja a kódos úton.
- A prompt pontos szövege; a modul helye (`src/deploy/` alatt, vagy recept-szerű modul `src/recipe/` alatt — a recept-registrybe vault-kimenet híján nem kerül).
- A próbamérés szűkítésének módja.

## Nem cél

- Új ablakos linkek (pcsontos/refinery-showroom#84).
- A vault-jegyzetek módosítása: az átalakítás csak a showroomba írt `.mdx`-et érinti.
- A `glossary` átalakítása, a nyers átirat kiküldése.
- Bíró/rubrika az átalakításra: a minőségkapu a kódos szó szerinti ellenőrzés.
- Törlés a showroomból (a #277 sem töröl).

## Elfogadási feltétel

Megfigyelhető viselkedésként:

1. Két valódi jegyzeten (egy `summary`, egy `clean-*`) a `refinery deploy` LLM-mel átalakított oldalt ír: a frontmatterben nincs `mdx_fallback`, az oldal lefordul, átmegy a #277 komponens-ellenőrzésén, a site-on a tetején a bevezető blokk látszik, alatta szakaszcímek és rövid bekezdések.
2. Ugyanezen a két jegyzeten a szó szerinti ellenőrzés zöld; egy szándékosan elrontott kimenet (egy szó kicserélve, egy mondat törölve, két szó felcserélve) mindhárom esetben bukást ad, és a deploy a determinisztikus változatot írja `mdx_fallback: true`-val, okkal a jelentésben.
3. A `flashcards`/`qa`/`bloom` kimenete ugyanarra a bemenetre kétszer futtatva bájtra azonos, `<Accordions>`-t tartalmaz, és nincs `mdx_fallback`.
4. Hamis `contract/mdx-components.json`-nal (pl. egy kitalált komponens hozzáadva) a következő futás promptja az új listát tartalmazza (teszt).
5. Egy második `refinery deploy` a már átalakított oldalakra 0 LLM-hívást és 0 commitot ad.
6. Egy oldal, amely kétszer elbukik, `mdx_failed`-et kap; a következő deploy (változatlan jegyzettel) nem hív rá LLM-et, a `--retry-failed` igen.
7. Alacsony `cost_limit_usd`-vel (teszt hamis árral) a deploy a plafonnál abbahagyja az LLM-hívásokat, a többi oldal fallback marad `mdx_failed` nélkül, a következő futás folytatja.
8. A `serve` `auto` útján a „kész" válasz a deploy előtt megy ki (teszt a hívássorrendre).
9. A deploy-jelentés kiírja az átalakítás költségét; a próbamérés valós költsége és a backfill-becslés a tervben rögzítve, a teljes kör csak ezután, jóváhagyással.
