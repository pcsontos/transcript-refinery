import { APICallError } from 'ai'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  extractObject,
  isForcedToolChoiceRejection,
  toolChoiceFallback,
} from './tool-fallback.js'

const SEMA = z.object({ score: z.number(), gaps: z.array(z.string()) })

/** A LiteLLM tényleges üzenete (2026-09-25, `logs/2026-09-26T08-08-21.md`). */
const OPUS_400 =
  'litellm.BadRequestError: AnthropicException - {"error":{"message":"claude-opus-5-5 does not support forced tool_choice; use auto or none","type":"invalid_request_error"},"type":"error"}. Received Model Group=sub2api--claude-opus-5-5'

function hivasHiba(message: string, responseBody?: string): APICallError {
  return new APICallError({
    message,
    url: 'http://localhost:4000/v1/chat/completions',
    requestBodyValues: {},
    statusCode: 400,
    responseBody,
    isRetryable: false,
  })
}

describe('isForcedToolChoiceRejection', () => {
  it('felismeri a gateway elutasítását az üzenetben', () => {
    expect(isForcedToolChoiceRejection(hivasHiba(OPUS_400))).toBe(true)
  })

  it('felismeri a válasz törzsében is', () => {
    expect(isForcedToolChoiceRejection(hivasHiba('Bad Request', OPUS_400))).toBe(true)
  })

  it('felismeri az ok-láncban is', () => {
    const burkolt = new Error('a hívás elbukott', { cause: hivasHiba(OPUS_400) })
    expect(isForcedToolChoiceRejection(burkolt)).toBe(true)
  })

  it('más 400-as hibát nem tekint elutasításnak', () => {
    expect(isForcedToolChoiceRejection(hivasHiba('context length exceeded'))).toBe(false)
  })

  it('nem objektum hibára hamis', () => {
    expect(isForcedToolChoiceRejection('does not support forced tool_choice')).toBe(false)
    expect(isForcedToolChoiceRejection(undefined)).toBe(false)
  })
})

describe('toolChoiceFallback', () => {
  it('kezdetben egyik modellt sem ismeri', () => {
    expect(toolChoiceFallback().has('opus')).toBe(false)
  })

  it('a rögzített modellt megjegyzi', () => {
    const fallback = toolChoiceFallback()
    fallback.add('opus')
    expect(fallback.has('opus')).toBe(true)
    expect(fallback.has('sonnet')).toBe(false)
  })

  it('modellenként egyszer jelez, ismételt rögzítésre nem', () => {
    const jelzett: string[] = []
    const fallback = toolChoiceFallback((model) => jelzett.push(model))
    fallback.add('opus')
    fallback.add('opus')
    fallback.add('grok')
    expect(jelzett).toEqual(['opus', 'grok'])
  })
})

describe('extractObject', () => {
  it('a tool-hívás argumentumát validálja', () => {
    expect(extractObject(SEMA, { score: 0.7, gaps: [] }, '')).toEqual({
      ok: true,
      value: { score: 0.7, gaps: [] },
    })
  })

  it('szövegként érkező tool-argumentumot is értelmez', () => {
    expect(extractObject(SEMA, '{"score":0.7,"gaps":[]}', '')).toEqual({
      ok: true,
      value: { score: 0.7, gaps: [] },
    })
  })

  it('a séma-sértő tool-argumentumot elutasítja, megnevezve a mezőt', () => {
    const result = extractObject(SEMA, { score: 0.7, gaps: 'nem tömb' }, '')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('gaps')
  })

  it('tool-hívás nélkül a szöveges JSON-t validálja', () => {
    expect(extractObject(SEMA, undefined, '{"score":0.4,"gaps":["x"]}')).toEqual({
      ok: true,
      value: { score: 0.4, gaps: ['x'] },
    })
  })

  it('a ```json kerítést leszedi', () => {
    const text = '```json\n{"score":0.4,"gaps":[]}\n```'
    expect(extractObject(SEMA, undefined, text)).toEqual({ ok: true, value: { score: 0.4, gaps: [] } })
  })

  it('a nyelv nélküli kerítést is leszedi', () => {
    const text = '```\n{"score":0.4,"gaps":[]}\n```'
    expect(extractObject(SEMA, undefined, text)).toEqual({ ok: true, value: { score: 0.4, gaps: [] } })
  })

  it('a szöveg körüli prózát levágja', () => {
    const text = 'Here is the result:\n{"score":0.4,"gaps":[]}\nHope this helps.'
    expect(extractObject(SEMA, undefined, text)).toEqual({ ok: true, value: { score: 0.4, gaps: [] } })
  })

  it('JSON nélküli szövegre beszédes okot ad', () => {
    const result = extractObject(SEMA, undefined, 'Sajnos ezt nem tudom pontozni.')
    expect(result).toEqual({ ok: false, reason: 'a modell szöveges válaszában nincs értelmezhető JSON' })
  })

  it('se tool-hívás, se szöveg: beszédes ok', () => {
    expect(extractObject(SEMA, undefined, '   ')).toEqual({
      ok: false,
      reason: 'a modell se tool-hívást, se szöveget nem adott',
    })
  })
})
