# Mérés — a `clean` szintek hűségküszöbe és kimeneti aránya

**Dátum:** 2026-09-25 · **Költés:** $2.71 (a script szerint), $3.71 (LiteLLM `/key/info` szerint) · **Modell:** vázlat `sub2api--claude-opus-5-5`, bíró nélkül

## Kérdés

A `clean` három szintre vált (mild, moderate, deep). Mindegyik saját hűségkaput kap
(`minWordRatio`, `minCoverage`) és saját `outputRatio`-t a költségbecsléshez. A
kezdőértékek (0,75/0,75, 0,75/0,75, 0,5/0,5; arány 0,95/0,95/0,75) feltevésből
jöttek. Mennyi a valós szóarány, lefedettség és kimeneti tokenarány szintenként?

## Módszer

Három elem azok közül, amelyeknek van régi `_clean.md` jegyzete: a legrövidebb, a
medián és a leghosszabb. Szintenként egy generálás, **bíró és hűségkapu nélkül**:
a kapu küszöbét épp most mérjük, a kezdőérték nem buktathatja el a mérést. Szkript:
`pnpm calibrate:clean --budget 10`, a felhasználó futtatta, hiba nélkül (exit 0,
nulla sikertelen generálás). A nyers adat (a kimenetekkel együtt) privát:
`evals/private/calibration-clean.json`, verziókövetésen kívül.

A minta:

- *How AI Is Changing Code Reviews & Software Development*, 1926 szó
- *How to start a 1-person business with AI (ask these 3 questions)*, 4050 szó (medián)
- *Cser Zoltán előadása (Szellemi Út Népfőiskola előadássorozata - Eger, 2024.11.07.)*, 17 466 szó

**A minta mindhárom eleme angol.** A Cser Zoltán-előadásnak a korpuszban csak
angol felirata van (`….en.srt`, gépi fordításnak tűnik). A magyar
töltelékszavakra vonatkozó szabályt (`öö`, `hát`, `ugye`, `szóval`, …) ez a
mérés tehát nem próbálta ki.

## Eredmény

| recept | szó | medián | szóarány | lefedettség | tokenarány | $ |
|---|---|---|---|---|---|---|
| clean-mild | 1926 |  | 0.96 | 0.92 | 1.29 | 0.083 |
| clean-mild | 4050 | igen | 1.01 | 0.98 | 1.30 | 0.171 |
| clean-mild | 17466 |  | 0.92 | 0.90 | 1.19 | 0.672 |
| clean-moderate | 1926 |  | 1.01 | 0.94 | 1.23 | 0.080 |
| clean-moderate | 4050 | igen | 1.04 | 0.98 | 1.30 | 0.171 |
| clean-moderate | 17466 |  | 0.91 | 0.87 | 1.22 | 0.686 |
| clean-deep | 1926 |  | 0.73 | 0.64 | 0.91 | 0.063 |
| clean-deep | 4050 | igen | 0.88 | 0.84 | 1.13 | 0.153 |
| clean-deep | 17466 |  | 0.78 | 0.73 | 1.11 | 0.635 |

## Küszöbszabály

- `minWordRatio` és `minCoverage`: a szint három mérése közül a **legkisebb** érték
  mínusz 0,05, két tizedesre lefelé kerekítve. A küszöb így minden mért jó
  kimenetet átenged, némi tartalékkal.
- `outputRatio`: a **medián** elemen mért tokenarány (kimeneti token / (szó ×
  1,35)), két tizedesre felfelé kerekítve. Ugyanez a szabály volt a bloom/notes
  kalibrálásánál is.

## Beállított értékek (`src/recipe/clean.ts`)

| szint | minWordRatio | minCoverage | outputRatio |
|---|---|---|---|
| mild | 0,75 → **0,86** | 0,75 → **0,84** | 0,95 → **1,30** |
| moderate | 0,75 → **0,86** | 0,75 → **0,82** | 0,95 → **1,30** |
| deep | 0,5 → **0,68** | 0,5 → **0,59** | 0,75 → **1,14** |

Az `outputRatio` mindhárom szinten egy fölé került. A kimenet a szöveg mellett a
bekezdésenkénti `[mm:ss]` időbélyegeket (mild, moderate) és a fejléceket
(moderate, deep) is hordozza, a tokenarány ezért nagyobb a szóaránynál. A régi
0,95/0,75 alulbecsülte a költséget.

## Szemrevételezés

Mind a kilenc kimenetre egy szkript megszámolta a fejléceket, az
időbélyeg alakú mintákat és a töltelékszavakat a forrásban és a kimenetben
(szószintű egyezéssel, kis- és nagybetű nélkül). Kézzel átnézett szöveg: a
legrövidebb elem mild, moderate és deep kimenetének eleje (kb. 14 sor), a
leghosszabb elem mild és deep kimenetének eleje, valamint e két elem mild és
deep kimenetének vége (az utolsó kb. 700 karakter). A medián elem kimeneteit
csak a szkript vizsgálta. A számok forrás/mild/moderate/deep
sorrendben.

| elem | `so` | `like` | `kind of` | `you know` | `actually` |
|---|---|---|---|---|---|
| 1926 szó | 37/33/33/4 | 6/3/3/1 | 5/0/0/0 | – | 4/1/3/1 |
| 4050 szó | 41/29/37/17 | 13/5/5/3 | 1/0/0/0 | 6/6/6/6 | 10/10/10/8 |
| 17 466 szó | 413/189/187/129 | 112/85/77/51 | 23/21/22/12 | 5/0/2/1 | 21/17/14/15 |

- **Töltelékszavak (mild, moderate):** eltűnnek, de mértékkel. A `so` a
  leghosszabb elemen a felére fogy (413 → 189). A `kind of` a két rövid elemen
  eltűnik, a leghosszabbon alig (23 → 21/22). Az
  `uh`/`um` a forrásokban nulla: a YouTube-feliratok eleve nem tartalmazzák,
  ezért van a mild szóaránya 1 közelében (0,92–1,01). A mild tehát nem
  hagyja figyelmen kívül a szabályt, egyszerűen kevés a kivágnivaló. A
  megmaradt `so`/`like` előfordulások közül a szúrópróbával ellenőrzöttek
  jelentést hordozó használatok voltak (kötőszó, ill. hasonlítás). Ezeket a
  szabály szándékosan meghagyja. Hogy mindegyik ilyen-e, azt nem
  ellenőriztem. Egy apróság: a mild a leghosszabb elem végén meghagyott egy
  szögletes zárójeles hangjelölést (taps).
- **A mild nem ír fejlécet:** mindhárom kimenetben nulla `#`-sor van,
  bekezdésenkénti `[mm:ss]` időbélyeggel.
- **A moderate** fejlécekkel tagol (9/12/19 fejléc), bekezdésenként
  időbélyeggel. A szóarány 1 fölött lehet (1,01; 1,04), mert a fejlécek szavai
  is beleszámítanak.
- **A deep** nem tartalmaz időbélyeget. Az egyetlen `\d:\d\d` alakú találat
  (a leghosszabb elemen) a beszédben elhangzó óraidő, nem időbélyeg. Kihagyott
  tartalomra nincs jel: a fejléclista mindhárom elemen végigköveti a beszéd
  szerkezetét, és a két, végéig átnézett deep kimenet (a legrövidebb és a
  leghosszabb elem) a beszéd záró gondolatáig és elköszönéséig ér, ugyanott
  zárul, ahol az ugyanazon elem mild kimenete. A legrövidebb elem alacsony szóaránya (0,73) átfogalmazásból és
  tömörítésből jön, nem hiányzó szakaszból.
- **Összefoglalás** egyik szinten sincs: a kimenetek a beszéd menetét követik,
  összegző szakasz vagy „Summary" fejléc nélkül.

Egyik szint kimenete sem volt láthatóan rossz, a prompt (`LEVEL_RULES`) nem
változott, ismételt mérés nem kellett.

## Költés

- A script saját könyvelése: **$2.71** (a `calibration-clean.json` `spentUsd`-je).
- LiteLLM `/key/info`: futás előtt `spend` 19.35430414, utána 23.05974414, tehát
  **$3.71**. Ez a hiteles összeg. A becslés $2.06 volt, a 2×-es ráhagyás ($4.11)
  lefedte a valós költést.
- **A $1.00-os (37%-os) eltérés oka nem ellenőrzött.** Az árazás nem
  magyarázza: a LiteLLM `/model/info` szerint a `sub2api--claude-opus-5-5` élő
  ára 4.0 / 20.0 USD millió tokenenként (be/ki), pontosan egyezik a
  konfiguráció `pricing.draft` értékével (4 / 20). A 2026-09-17-i fordítási
  mérésnél a `/key/info` különbsége még egyezett a script könyvelésével. Nem
  kizárt okok, egyiket sem igazoltam: más forgalom ugyanazon a kulcson a futás
  alatt; a cache-írás drágább ára, amelyet a `ModelUsage` nem különböztet meg (a
  `/model/info` szerint 5.0 USD millió tokenenként; a mintán kb. 95 ezer
  bemeneti tokennel számolva ez legfeljebb kb. $0.10 többlet, egyedül tehát
  nem magyarázza); vagy olyan hívás, amelyet a proxy számláz, de a kliens nem
  könyvel el. A kérésenkénti LiteLLM költésnaplóhoz (`/spend/logs`)
  a kulcsnak nincs jogosultsága (admin kell), ezzel lehetne tisztázni.

## A mérés korlátja

Három elem, egy ismétlés, egyetlen modell: a küszöb a mért minimum alatt van,
de eloszlást nem mutat. Mindhárom elem angol, a magyar töltelékszavak kezelése
és a magyar szöveg szóaránya méretlen. Más draft modell esetén a küszöböket
újra kell mérni.
