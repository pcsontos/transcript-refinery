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
