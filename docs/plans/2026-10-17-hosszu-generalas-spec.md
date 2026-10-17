# Spec — Hosszú generálás: streamelt hívás, 25 perces receptkorlát, életjel és rákérdezés

**Dátum:** 2026-10-17 · **Státusz:** tervezés alatt

Ez a dokumentum a #258 issue tervezéséből készült. Ahol ez a spec nem mond mást, a mai viselkedés marad.

## A cél egy mondatban

Egy hosszú recept (pl. egy egyórás webinár `clean-deep`-je, 10–15 perc) egyetlen modellhívással végigfusson. Ami 25 percnél tovább tartana, az álljon meg újrapróbálkozás nélkül, és a Telegram kérdezzen rá, hogy újra próbálja-e vagy eldobja. Közben 10 percenként jöjjön életjel.

## Miért

2026-10-17-én a peter-mba-n a `zgWUhE6HjrI` `clean-deep` (44 358 → 14 870 szó, `sub2api--claude-sonnet-5`) elbukott. A hibalánc a #258-ban van leírva. Röviden: a streaming nélküli hívásnál a fejléc csak a generálás végén érkezik meg, ezért a kliens kb. 5 perc után `Headers Timeout Error`-ral feladja. A gateway viszont 9 perc 20 másodpercig tovább generál, és ezt kifizetjük. Az újrapróbálkozás 429-et kap, mert a sub2api felhasználói `concurrency` értéke 1, és a helyet még az elhagyott hívás foglalja.

A felhasználónak az a fontos, hogy a hosszú munka végigfusson, és legyen eredmény. A dupla költés másodlagos, de jó, ha megszűnik.

## Ezen a körön kívül

- A bemenet darabolása: a fordításé a #259, az önálló szójegyzék-recept a #260. A `clean-*` darabolása sehol sincs betervezve.
- A sub2api `concurrency` értékének emelése (homelab-beállítás, és csak tünetkezelés lenne).

## Döntések a tervezésből

| Kérdés | Döntés | Kié |
|---|---|---|
| Mennyi ideig futhat egy munka? | **Receptenként** legfeljebb 25 perc. Egy több receptből álló futás összesen ennél tovább is tarthat. | felhasználó |
| Mi történik 25 percnél? | A recept leáll, **nem próbálkozik újra**, és a Telegram rögtön rákérdez: **Újra** vagy **Eldobás**. | felhasználó |
| A futás többi receptje? | Tovább fut. | felhasználó |
| Mikor jön a kérdés? | Rögtön, amikor a recept leáll, nem a futás végén. | felhasználó |
| Életjel | 10 percenként egy üzenet, hogy hol tart, illetve hogy még dolgozik. A Telegramról indított futásnál és a `refinery run`-nál is. | felhasználó |
| Az életjel útja | A pipeline eseménye (mint a mai `item:generating`). A CLI terminálsorként írja ki, a serve a Workernek küldi tovább. A `watch` nem futtat receptet (`src/watch/round.ts:63`), ezért ott nincs életjel. | tervező |
| Mikor indul az életjel órája? | A recept indulásakor, a 25 perces órával együtt, nem a futás elején. | tervező |
| Az 5 perces vágás ellenszere | Streamelt hívás. | tervező |
| Mit mond az életjel? | A futó recept nevét és a már legenerált szavak hozzávetőleges számát, pl. `clean-deep: kb. 9 000 szó kész, még dolgozik`. | tervező |
| Életjel módja | Új Telegram-üzenet, nem a „elindult” üzenet szerkesztése. | tervező |
| A rövid, átmeneti hibák (503, 429, kapcsolati hiba) | A 25 percen belül a mai módon újrapróbálódnak. | tervező |
| A futás állapota leállás után | `failed`, a leállás okával. Külön hibaüzenet nem megy, a rákérdező üzenet maga a hibajelzés. | tervező |
| Mit csinál az „Újra”? | Ugyanazt a futást indítja újra a mai `retry` úton (`decideRun`: `failed` → `retry`). A futás már elkészült jegyzeteit a pipeline kihagyja (`src/pipeline.ts:204`), tehát csak a leállt recept fut újra. | tervező |
| A megszakított hívás költsége | A költségőr nem becsüli (a megszakított stream nem ad használati adatot). Az esemény jelzi, hogy a költség ismeretlen. | tervező |
| Mit csinál az „Eldobás”? | Semmit sem futtat. Az üzenet gombjai eltűnnek, és jelzi, hogy eldobva. | tervező |
| CLI-ből indított futás | Ugyanez a 25 perc érvényes, de nincs kit megkérdezni: sima hiba, újrapróbálkozás nélkül. | tervező |
| A 25 és a 10 perc | Configból állítható (6. pont). | felhasználó |
| A beállítások neve és helye | `model.recipe_timeout_minutes` (alap 25) és `model.heartbeat_minutes` (alap 10), a `judge_enabled` mellett. Mindkettő elhagyható. | tervező |

## 1. Streamelt modellhívás

### Ma

A `src/model/client.ts` mindhárom útvonala (`generate`, a sémás `generateObject` és a tool-visszaesés `viaTool`-ja) `generateText`-et hív, streaming nélkül. A `createOpenAICompatible` saját `fetch` nélkül fut, tehát a Node globális `fetch`-e (undici) érvényes, aminek a `headersTimeout` alapértéke 300 s. Az AI SDK (`ai@7.0.91`) saját időkorlátot csak akkor állít, ha a hívó `timeout`-ot ad (`getTotalTimeoutMs(undefined)` → nincs korlát, `node_modules/ai/dist/index.js:2222`). A kódban ilyen nincs, tehát a vágást az undici okozza. Ezt a forrás olvasása alapján állítom; egy próbával (lásd az elfogadási feltételeket) kell megerősíteni.

### Új viselkedés

- Mindhárom útvonal streamelt hívással megy (`streamText`, a sémás útnál `output`-tal). A fejléc így azonnal megérkezik, és a `headersTimeout` nem vág.
- A hívó felé semmi sem változik: ugyanaz a `ModelResult` jön vissza (érték és használat). Megmarad:
  - a `finishReason`-kapu (`ellenorizdAVeget`), a mai tételes felsorolással;
  - a kényszerített `tool_choice` elutasításakor a visszaesés a `viaTool` útra, és az emlékezete (`isForcedToolChoiceRejection`, `toolChoiceFallback`);
  - a `viaTool` `extractObject`-je és `NoObjectGeneratedError`-ja;
  - a `supportsStructuredOutputs: true`.
- A streamből a kliens a legenerált szöveg hosszát is látja. Ebből számolódik az életjel szószáma (2. pont). A sémás útnál a részleges JSON hossza is elég: az életjel csak hozzávetőleges.
- A body-időkorlát (`bodyTimeout`, alapból 300 s két adatcsomag között) streamelt válasznál nem vág, mert folyamatosan jönnek a darabok. Ha mégis vágna, az átmeneti hibának számít, és a 25 percen belül újrapróbálódik.

## 2. Életjel 10 percenként

- Amíg egy recept fut, a pipeline 10 percenként életjel-eseményt ad ki a mai eseményút (`sink`) mentén. Így az a JSONL-naplóba is bekerül.
- **`refinery run`:** a terminál egy sort ír ki belőle, a mai `item:generating` sor mintájára (`src/cli.ts:124`).
- **Telegram:** a serve az eseményt üzenetként továbbítja a Workernek, a Worker pedig új Telegram-üzenetként küldi el ugyanabba a chatbe.
- A szöveg: a futó recept azonosítója és a már legenerált szavak hozzávetőleges száma, pl. `clean-deep: kb. 9 000 szó kész, még dolgozik`. Ha épp nincs folyamatban generálás (pl. a judge fut, vagy két recept között jár), elég ennyi: `Még dolgozik: clean-deep`.
- Az első életjel 10 perccel a recept indulása után jön, nem az indításkor. Egy 10 percen belül kész recept tehát nem kap életjelet.
- Az életjel nem változtat a futás állapotán a Worker adatbázisában. Ha nem sikerül elküldeni, a futás megy tovább, a következő 10 perc újra próbálja.
- A serve → Worker út ma két állapotot ismer (`ready`, `failed`, `src/serve/job.ts` `CallbackBody`, Worker oldalon `isCallback` és `handleCallback`). Ehhez jön egy harmadik, köztes üzenetfajta. Az alakja az építőre van bízva.

## 3. 25 perc receptenként

- Minden recept indulásakor egy 25 perces óra indul. Ide tartozik a recept összes modellhívása: a generálás, a judge, és ezek újrapróbálkozásai is.
- Ha az óra lejár, a futó hívás megszakad (a kliens bontja a streamet), és a recept hibával zárul, újrapróbálkozás nélkül.
  - **Figyelem:** ma a `retry.ts` a `TimeoutError` és az `AbortError` nevű hibát átmenetinek veszi, és újrapróbálja. A 25 perces leállást ettől meg kell különböztetni, különben háromszor futna le, összesen akár 75 percig.
  - Az AI SDK saját belső újrapróbálkozása (`maxRetries`, alapból 2; ez írta a „Failed after 3 attempts” sort) se induljon újra a 25 perc után.
- A hiba a naplóba és az állapottárba a mai `item:failed` / `recordArtifact(…, 'failed', …)` úton kerül, de olyan okkal, amelyből a serve és az ember is látja, hogy a 25 perces korlát állította meg, nem más hiba.
- A futás a következő recepttel folytatódik.
- A Telegram-útnál a serve **rögtön** üzen a Workernek a leállásról, nem a futás végén (4. pont).
- A `serve` mai cancel-jele (`/cancel`) változatlanul működik, a 25 perces órától függetlenül.

## 4. Rákérdezés Telegramon: Újra vagy Eldobás

- A leállás pillanatában a Worker üzenetet küld a chatbe, pl.: `A clean-deep 25 perc után sem készült el, ezért leállítottam. Újra próbáljam?`, két gombbal: **Újra** és **Eldobás**.
**Milyen futások vannak ma?** Egy Telegram-futás vagy egyetlen alaprecept (a receptgomb mindig egyet indít, `worker/src/handle.ts:689`), vagy egy vagy több fordítás (`<recept>-<nyelv>`). Fordítás csak már kész alaprecepthez kérhető (`readyBases`), tehát alaprecept és a ráépülő fordítás sosem fut egy futásban. „A többi recept fut tovább” így a többnyelvű vagy több forrásból álló fordításfutásra és a CLI-re vonatkozik.

- **Újra:** a futás a mai `retry` úton indul újra, ugyanazzal a futásazonosítóval (`runId` determinisztikus, `decideRun`: `failed` → `retry`). A már elkészült jegyzeteit a pipeline kihagyja, így csak a leállt recept fut újra. Ha a serve még dolgozik, az újraindítás a mai módon várakozik (`409` → `waiting`, a cron újrakopogtat).
- **Eldobás:** nem indul semmi. A gombok eltűnnek, az üzenet jelzi, hogy eldobva. A futás `failed` marad, a receptgombbal később bármikor újra kérhető.
- Ha a felhasználó nem nyom semmit, nem történik semmi.
- **A futás vége, ha volt leállás:** a futás `failed` lesz, a leállás okával.
  - Ha a futásban más jegyzet nem készült el, nem megy több üzenet, a rákérdezés elég.
  - Ha más jegyzet elkészült (többrészes fordításfutás), a záró üzenet **csak az elkészült jegyzetek** linkjét sorolja. Ma a `runReadyMessage` a futás összes fajtáját linkeli (`runKinds`). Ezért a serve → Worker záró üzenetnek tartalmaznia kell az elkészült fajtákat. Ez a mai `ready`/`failed` szerződés bővítése.
- **A futás vége, ha nem volt leállás:** a mai módon.
- A 25 perc miatt leállt recept nem kerül a vaultba. A többi jegyzet a mai módon commitolódik és pusholódik.

## 5. Ami még nincs igazolva

- **A gateway leállítja-e a generálást, amikor a kliens bontja a streamet?** Ha a LiteLLM és a sub2api a kapcsolat bontására nem állítja le a felső hívást, akkor a 25 percnél leállított recept generálása tovább fut, kifizetjük, és a helyet is foglalja (a következő hívás 429-et kap). Ezt egy próbával kell kideríteni a peter-mba-n (LiteLLM `LiteLLM_SpendLogs`, sub2api napló). Ha nem állítja le, az eredmény kerüljön a spec végére, és nyissunk róla külön issue-t. A 25 perces korlát ettől még a kért módon működik.
- Az undici 300 s-os `headersTimeout`-ja mint ok: a forrás alapján valószínű, próbával kell megerősíteni.

## 6. A két időkorlát a configban

```yaml
model:
  # Egy recept leghosszabb futásideje percben; utána újrapróbálkozás nélkül leáll.
  # recipe_timeout_minutes: 25
  # Az életjel időköze percben, amíg egy recept fut.
  # heartbeat_minutes: 10
```

- Mindkettő pozitív szám, tört is lehet (pl. `0.5` egy gyors próbához). A nulla, a negatív és a nem szám érték config-hiba, a mai config-hibák módján, a mező nevével.
- Ha hiányzik, az alapérték érvényes: 25, illetve 10 perc.
- Az üzenetek a beállított értéket mondják, nem a 25-öt (pl. `… 40 perc után sem készült el …`).
- A `serve` a configot receptfutásonként tölti be, mint ma. A változás tehát újraindítás nélkül hat.
- A `refinery.config.example.yaml` és a `docs/usage.md` leírja mindkettőt.

## Elfogadási feltételek

Megfigyelhető viselkedés, nem fájltartalom:

1. A `zgWUhE6HjrI` `clean-deep`-je Telegramról indítva a peter-mba-n végigfut. Egyetlen generáló LiteLLM-hívás tartozik hozzá (a judge hívása ezen felül), `success` állapottal, újrapróbálkozás nélkül. Nincs 429 és nincs `Headers Timeout Error`. A jegyzet a vaultba kerül, a chatbe megjön a `ready` üzenet.
2. Ugyanennél a futásnál, ha az 10 percnél tovább tart, a chatbe a 10. perc körül megérkezik egy életjel a recept nevével és egy szószámmal.
3. Tesztben (hamis modellel, rövidített órával): egy recept, amely a korláton túl futna, megszakad. A hamis modell pontosan egy hívást kap (nincs újrapróbálkozás). A futás következő receptje lefut. A serve rögtön elküldi a leállásról szóló üzenetet, még a futás vége előtt.
4. Tesztben: a Worker a leállás üzenetére két gombos üzenetet küld. Az **Újra** ugyanazt a futást indítja újra, és az újrafuttatás csak a leállt receptre hív modellt. Az **Eldobás** nem kér futást. Egy egyreceptes futás leállása után nem megy külön hibaüzenet. Egy kétnyelvű fordításfutásnál, ahol az egyik nyelv leállt, a záró üzenet csak a kész nyelv linkjét tartalmazza.
5. Tesztben (rövidített órával): egy `refinery run` futás, amelynek a receptje az életjel-időköznél tovább tart, kiír a terminálba egy életjelsort a recept nevével. Egy ennél rövidebb futás nem ír ilyet.
6. Tesztben: egy átmeneti hiba (503) a korláton belül a mai módon újrapróbálódik.
7. Tesztben: `model.recipe_timeout_minutes: 40` mellett a recept 25 percnél még fut, 40-nél leáll, és az üzenetben `40 perc` áll. A `recipe_timeout_minutes: 0` config-hibát ad a mező nevével.
8. A meglévő tesztek a `finishReason`-kapura, a tool-visszaesésre és a sémás útra változatlanul zöldek.
9. Az 5. pont próbája lefutott, és az eredménye le van írva.

## Az építőre bízva

- A streamelt hívás pontos AI SDK-alakja, és hogy a 25 perces óra jele hogyan jut el a kliensig (pl. `abortSignal` a `ModelClient` felületén).
- A serve → Worker köztes üzenet és a Worker-gombok `callback_data` alakja, a meglévő minták szerint (`messages.ts`).
- Az üzenetek pontos szövege, a fenti példák szellemében.
- Hogy a szószám a stream szöveges darabjaiból vagy a karakterszámból becsült-e.
