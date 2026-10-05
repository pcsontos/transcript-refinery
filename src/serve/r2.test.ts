import { describe, expect, it } from 'vitest'
import { createR2Store, signR2, type R2Config } from './r2.js'

const config: R2Config = {
  accountId: 'account',
  bucket: 'refinery',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
}

describe('signR2', () => {
  it('a rögzített PUT kérés aláírása stabil', () => {
    const signed = signR2({
      method: 'PUT',
      key: 'videos/abcdefghijk/hu.vtt',
      body: new TextEncoder().encode('felirat'),
      now: new Date('2015-08-30T12:36:00Z'),
      config,
    })
    expect(signed.url).toBe(
      'https://account.r2.cloudflarestorage.com/refinery/videos/abcdefghijk/hu.vtt',
    )
    expect(signed.headers['x-amz-date']).toBe('20150830T123600Z')
    expect(signed.headers['x-amz-content-sha256']).toBe(
      '596a51f53168cadf8af76759ff459b3b921a2ca55ec12a46a93a5ed8b9671aa6',
    )
    expect(signed.headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/auto/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=5bc2cef8a7d0afd039032397e4e866058a8b430a2265f5313e7f0cf7ff077494',
    )
  })
})

describe('createR2Store', () => {
  it('a list üres kulcslistát ad, a put a törzset küldi, a get visszaadja', async () => {
    const calls: { method: string; url: string; body: string }[] = []
    const fetchImpl: typeof fetch = (input, init) => {
      const method = init?.method ?? 'GET'
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      calls.push({
        method,
        url,
        body: typeof init?.body === 'string' ? init.body : '',
      })
      if (method === 'GET' && url.includes('list-type=2')) {
        return Promise.resolve(new Response('<ListBucketResult></ListBucketResult>', { status: 200 }))
      }
      if (method === 'PUT') return Promise.resolve(new Response(null, { status: 200 }))
      return Promise.resolve(new Response('felirat', { status: 200 }))
    }
    const store = createR2Store(config, fetchImpl, () => new Date('2015-08-30T12:36:00Z'))
    expect(await store.list('videos/abcdefghijk/')).toEqual([])
    await store.put('videos/abcdefghijk/hu.vtt', new TextEncoder().encode('felirat'))
    expect(calls[1]?.method).toBe('PUT')
    expect(calls[1]?.url).toContain('/refinery/videos/abcdefghijk/hu.vtt')
    const got = await store.get('videos/abcdefghijk/info.json')
    expect(new TextDecoder().decode(got ?? new Uint8Array())).toBe('felirat')
  })
})
