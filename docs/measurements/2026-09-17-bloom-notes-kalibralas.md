# Mérés — a Bloom- és a jegyzetrecept kimeneti aránya

**Dátum:** 2026-09-17 · **Költés:** $0.77 · **Modellek:** vázlat `claude-sonnet-5`, bíró `claude-sonnet-5`

## Kérdés

A spec kezdő `outputRatio` értékei (bloom 0,74, notes 0,30) feltevésből jöttek.
Mennyi a valós kimenet a bemenet arányában, és kíméli-e a pedagógiai bíró a
szabad zónákat?

## Módszer

Három elem a korpuszból — a legrövidebb, a medián és a leghosszabb —,
receptenként egy generálás, a teljes rubrikával. Szkript:
`pnpm calibrate --budget 2`. A nyers adat privát, verziókövetésen kívül.

**Modellváltás menet közben:** az első futás a konfigurált `draft: minimax-m3`
modellel mind a hat próbán elbukott — a modell szabad Markdown szöveget adott
a kért sémás JSON helyett (`AI_NoObjectGeneratedError`), tehát a kalibrálás
nulla használható adatot hozott. A második futás `draft: claude-sonnet-5`-re
átállítva sikerrel lezajlott; ez a dokumentum ennek az adatait tartalmazza.

## Eredmény

| recept | szó | medián elem | kimeneti token | arány | pontszám | $ |
|---|---|---|---|---|---|---|
| bloom | 1926 |  | 4165 | 1.60 | 0.90 | 0.073 |
| bloom | 4050 | igen | 4401 | 0.80 | 0.96 | 0.090 |
| bloom | 22477 |  | 4776 | 0.16 | 0.88 | 0.231 |
| notes | 1926 |  | 2199 | 0.85 | 0.94 | 0.047 |
| notes | 4050 | igen | 5962 | 1.09 | 0.90 | 0.112 |
| notes | 22477 |  | 3294 | 0.11 | 0.73 | 0.213 |

## Döntés

- `bloom.outputRatio`: 0,74 → **0,81**, a medián elemen mért arány felfelé kerekítve.
- `notes.outputRatio`: 0,30 → **1,10**, ugyanígy.
- A becslés a teljes korpuszra az új aránnyal: bloom ~$2,31, notes ~$2,87 (19 elem).
- A pedagógiai bíró: a hat rekord hiánylistáit átnézve **egyetlen olyan hiány
  sincs**, amely egy szabad zónát (Example, Variation, Why, vagy egy
  Apply–Create szintű kártya) pusztán az átirat túllépéséért kifogásolna,
  ellentmondás nélkül. A faithfulness-jellegű hiányok mind valódi találatok:
  vagy tényleges pontatlanságot/belső ellentmondást neveznek meg (pl. a bloom
  kártya válasza nem egyezik a saját "Why" magyarázatával), vagy egy nem
  szabad zónában (törzsszöveg, diagram) toldott, az átiratban nem szereplő
  állítást — pontosan azt, amit a szabálynak tiltania kell. A többi hiány a
  lefedettség-bíróé (hiányzó témák), nem a hűségbíróé.
- **Külön megfigyelés, nem a kalibrálás tárgya:** a `draft: minimax-m3`
  jelenleg nem alkalmas sémás (`generateObject`) receptekhez ezen a LiteLLM
  beállításon — figyelmen kívül hagyja a kért JSON-sémát, és szabad szöveget
  ad helyette. Ez a `bloom` és a `notes` mellett minden jövőbeli sémás
  receptet érintene, és érdemes külön megvizsgálni, mielőtt a `draft` szerepet
  éles használatra visszaállítanák minimax-m3-ra. A jelen szeletben a
  munkamenet a `claude-sonnet-5`-tel folytatódik (a 7. feladat füstpróbája is),
  a `minimax-m3` kivizsgálása külön, későbbi döntés.

## A mérés korlátja

Három elem, egy ismétlés: az arány nagyságrendjét mutatja, nem eloszlást.
