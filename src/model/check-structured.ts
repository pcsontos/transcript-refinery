import type { ZodType } from 'zod'
import type { ModelConfig } from '../config.js'
import { BloomSchema } from '../recipe/bloom.js'
import { FlashcardsSchema } from '../recipe/flashcards.js'
import { NotesSchema } from '../recipe/notes.js'
import { SCHEMA_ERRORS } from '../recipe/structured.js'
import { createModelClient, type ModelClient } from './client.js'
import { withDraftModel } from './recipe-model.js'

/** A sémás receptek sémája; a teszt ellenőrzi, hogy a registry sémás receptjeivel egyezik. */
export const PROBE_SCHEMAS = { flashcards: FlashcardsSchema, notes: NotesSchema, bloom: BloomSchema }

/** Egy próba tokenje ráhagyással: mérve kb. 3,5 ezer be (séma + utasítás), 0,8–1,1 ezer ki (2026-10-23). */
const PROBE_TOKENS = { inputTokens: 4000, outputTokens: 1500 }

/** Próbák száma modellenként és sémánként: egy próba nem döntés, a kimenet ingadozhat. */
const RUNS = 3

const PROBE_PROMPT = [
  'Készíts tananyagot az alábbi rövid szövegből, magyarul.',
  '',
  'A fotoszintézis során a növények a napfény energiáját kémiai energiává alakítják.',
  'A folyamat a kloroplasztiszokban zajlik, mellékterméke az oxigén.',
].join('\n')

function probeUsd(view: ModelConfig): number {
  const price = view.pricing.draft
  return (PROBE_TOKENS.inputTokens * price.inputPerMillion + PROBE_TOKENS.outputTokens * price.outputPerMillion) / 1e6
}

/**
 * Kiméri, hogy a `model.switchable` modelljei adnak-e sémás kimenetet, és összeveti a config
 * jelzésével (#304). A configot nem írja át. 0: minden modell mérhető volt és nincs eltérés; 1: eltérés,
 * nem mérhető modell (csak egyéb hiba: hálózat, csonkolás), vagy a becslés kétszerese a plafon fölött.
 */
export async function commandCheckStructured(
  cfg: ModelConfig,
  createClient: (view: ModelConfig) => ModelClient = (view) => createModelClient(view),
): Promise<number> {
  const models = Object.entries(cfg.switchable ?? {}).map(([model, declared]) => ({
    model,
    declared,
    view: withDraftModel(cfg, model, 'model.switchable'),
  }))
  if (models.length === 0) {
    console.log('A model.switchable üres: nincs mit mérni.')
    return 0
  }
  // A három séma típusa különbözik; a próbának az érték alakja közömbös.
  const schemas: ZodType[] = Object.values(PROBE_SCHEMAS)
  const estimate = models.reduce((sum, { view }) => sum + RUNS * schemas.length * probeUsd(view), 0)
  console.log(
    `${models.length} modell × ${schemas.length} séma × ${RUNS} próba, becsült költség legfeljebb ${estimate.toFixed(4)} $ (plafon: ${cfg.costLimitUsd} $).`,
  )
  // ponytail: nincs menet közbeni költségőr; a 2× ráhagyású becslés a felső korlát. Őr kell, ha a próba nagyobb lesz.
  if (estimate * 2 > cfg.costLimitUsd) {
    console.error('A becslés kétszerese a cost_limit_usd fölött van: nagyobb plafon vagy rövidebb switchable lista kell.')
    return 1
  }

  let failed = false
  let measuredUsd = 0
  for (const { model, declared, view } of models) {
    const client = createClient(view)
    const tally = { ok: 0, schema: 0, other: 0 }
    for (let run = 0; run < RUNS; run++) {
      for (const schema of schemas) {
        try {
          const { usage } = await client.generateObject('draft', PROBE_PROMPT, schema)
          measuredUsd +=
            (usage.inputTokens * view.pricing.draft.inputPerMillion +
              usage.outputTokens * view.pricing.draft.outputPerMillion) /
            1e6
          tally.ok++
        } catch (error) {
          if (SCHEMA_ERRORS.has((error as Error).name)) tally.schema++
          else tally.other++
        }
      }
    }
    const tried = tally.ok + tally.schema
    const measured = tried === 0 ? '?' : tally.schema === 0 ? 'structured' : 'text'
    // `?`: csak egyéb hiba volt (hálózat, csonkolt válasz), a modellről nincs mérés: ez nem „nincs eltérés”.
    const differs = measured !== '?' && measured !== declared
    if (differs || measured === '?') failed = true
    const other = tally.other === 0 ? '' : `, ${tally.other} egyéb hiba`
    const mark = differs ? '  ← ELTÉR' : measured === '?' ? '  ← NEM MÉRHETŐ' : ''
    console.log(`${model}: config ${declared}, mért ${measured} (${tally.ok}/${tried} sémás${other})${mark}`)
  }
  // A séma-hibával végződő hívások használata nem látszik, ezért ez alsó becslés.
  console.log(`Mért költség legalább ${measuredUsd.toFixed(4)} $ (a sikeres hívások használatából).`)
  return failed ? 1 : 0
}
