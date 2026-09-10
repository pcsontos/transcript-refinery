import type { ModelConfig } from '../../src/config.js'
import type { ModelClient } from '../../src/model/client.js'
import type { CostGuard } from '../../src/model/budget.js'

/**
 * Költségmérő burkoló a modellkliens köré.
 *
 * Két hibát szüntet meg egyszerre, amiket a hívó oldalán nem lehet jól
 * megoldani:
 *
 * 1. **A bukott futások költése is számít.** Ha a `refine` a harmadik körben
 *    dob, az addigi generálások és bíró-hívások már ki vannak fizetve. A
 *    hívó oldalán csak a sikeres ág látja a felhasználást, tehát a bukások
 *    költése láthatatlan maradna — épp abban a helyzetben, amit a pilóta
 *    ténylegesen produkált (a kártyarecept minden futása elbukott).
 * 2. **Minden hívás a SAJÁT szerepe árán könyvelődik.** A kör nyomvonalában a
 *    generálás és a pontozás felhasználása össze van adva; ha azt egyben a
 *    vázlatmodell árán számolnánk, a bíró tokenjei két és félszeres áron
 *    jelennének meg a riportban.
 *
 * A burkoló a hívás helyén könyvel, ahol a szerep még ismert, ezért mindkét
 * probléma megszűnik.
 */
export function metered(
  client: ModelClient,
  guard: CostGuard,
  cfg: ModelConfig,
): ModelClient {
  return {
    async generate(role, prompt) {
      const result = await client.generate(role, prompt)
      guard.add(role, result.usage, cfg)
      return result
    },
    async generateObject(role, prompt, schema) {
      const result = await client.generateObject(role, prompt, schema)
      guard.add(role, result.usage, cfg)
      return result
    },
  }
}
