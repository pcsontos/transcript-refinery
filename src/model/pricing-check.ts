import { isMap, isScalar, parseDocument } from 'yaml'
import type { ModelPricing } from '../config.js'
import type { ModelRole } from '../types.js'

/** USD egymillió tokenre, a LiteLLM `/model/info` válaszából számolva. */
export interface LivePricing {
  inputPerMillion: number
  outputPerMillion: number
}

interface ModelInfoResponse {
  data?: {
    model_name?: string
    model_info?: {
      input_cost_per_token?: number
      output_cost_per_token?: number
    }
  }[]
}

/**
 * A LiteLLM proxy élő árazását kérdezi le. A `/model/info` a proxy gyökerén
 * él, nem a `base_url` alatt — az utóbbi a `/v1` chat-completions útvonalra
 * mutat, ezt itt le kell vágni.
 */
export async function fetchLivePricing(
  baseUrl: string,
  apiKey: string,
): Promise<Map<string, LivePricing>> {
  const root = baseUrl.replace(/\/v1\/?$/, '')
  const res = await fetch(`${root}/model/info`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) {
    throw new Error(`A LiteLLM /model/info hívása sikertelen: HTTP ${String(res.status)}`)
  }
  const body = (await res.json()) as ModelInfoResponse
  const live = new Map<string, LivePricing>()
  for (const entry of body.data ?? []) {
    const name = entry.model_name
    const input = entry.model_info?.input_cost_per_token
    const output = entry.model_info?.output_cost_per_token
    if (!name || !input || !output) continue
    live.set(name, { inputPerMillion: input * 1_000_000, outputPerMillion: output * 1_000_000 })
  }
  return live
}

export interface PricingMismatch {
  role: ModelRole
  model: string
  configured: ModelPricing
  live: LivePricing
}

export interface PricingCheckResult {
  mismatches: PricingMismatch[]
  /** A configban szereplő modell, amit a LiteLLM nem ismer — nem ellenőrizhető. */
  unknown: { role: ModelRole; model: string }[]
}

/**
 * Egycentes tolerancia: a configban két tizedesjegyre kerekített számok
 * állnak, a LiteLLM token-alapú árából visszaszorozva apró kerekítési zaj
 * keletkezhet, ami nem valódi eltérés.
 */
const TOLERANCE_USD = 0.01

/** Szerepenként hasonlítja a configban rögzített árat az élő LiteLLM-árhoz. */
export function comparePricing(
  models: Record<ModelRole, string>,
  pricing: Record<ModelRole, ModelPricing>,
  live: Map<string, LivePricing>,
): PricingCheckResult {
  const mismatches: PricingMismatch[] = []
  const unknown: { role: ModelRole; model: string }[] = []
  for (const role of Object.keys(models) as ModelRole[]) {
    const model = models[role]
    const liveRate = live.get(model)
    if (!liveRate) {
      unknown.push({ role, model })
      continue
    }
    const configured = pricing[role]
    const inputOff = Math.abs(configured.inputPerMillion - liveRate.inputPerMillion) > TOLERANCE_USD
    const outputOff =
      Math.abs(configured.outputPerMillion - liveRate.outputPerMillion) > TOLERANCE_USD
    if (inputOff || outputOff) {
      mismatches.push({ role, model, configured, live: liveRate })
    }
  }
  return { mismatches, unknown }
}

/**
 * Két tizedes: a config ebben az alakban tartja az árakat, a LiteLLM
 * token-alapú árából visszaszorozva pedig lebegőpontos zaj keletkezhet.
 */
const round2 = (value: number): number => Math.round(value * 100) / 100

/**
 * A configban rögzített árat a LiteLLM élő értékeire írja át.
 *
 * **A forrás YAML-on szerkeszt**, nem az elemzett objektumból épít új
 * szöveget: a `pricing:` blokk fölötti magyarázó megjegyzés és a flow-alak
 * (`{ … }`) enélkül elveszne. A meglévő csomópont értékeit állítjuk, magát a
 * csomópontot nem cseréljük — ez őrzi meg az alakját.
 */
export function applyPricingFix(
  configText: string,
  mismatches: readonly PricingMismatch[],
): string {
  const doc = parseDocument(configText)
  for (const mismatch of mismatches) {
    const node = doc.getIn(['pricing', mismatch.role])
    if (!isMap(node)) continue
    node.set('input_per_million', round2(mismatch.live.inputPerMillion))
    node.set('output_per_million', round2(mismatch.live.outputPerMillion))
    // A forrás tizedesjegyeinek száma (pl. "2.00") a Scalar
    // `minFractionDigits`-jén él tovább a `set()` után is; enélkül egy egész
    // új ár is felesleges tizedesekkel íródna ki (pl. "3.00" a "3" helyett).
    for (const key of ['input_per_million', 'output_per_million']) {
      const scalar = node.get(key, true)
      if (isScalar(scalar)) scalar.minFractionDigits = undefined
    }
  }
  return String(doc)
}
