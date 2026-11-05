import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createR2Store, createS3Store, signR2, signS3, type R2Config } from './r2.js'

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

describe('signS3', () => {
  it('AWS SigV4 referencia: GET Bucket (List Objects), virtual-hosted, us-east-1', () => {
    const signed = signS3({
      method: 'GET',
      key: '',
      payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      now: new Date('2013-05-24T00:00:00Z'),
      query: { 'max-keys': '2', prefix: 'J' },
      config: {
        endpoint: 'https://s3.amazonaws.com',
        region: 'us-east-1',
        bucket: 'examplebucket',
        pathStyle: false,
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      },
    })
    // Az AWS-dokumentáció értéke; független számolással egyezik. Ha bukik, a kód a hibás, nem a várt érték.
    expect(signed.headers.authorization).toContain('Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7')
    expect(signed.url).toBe('https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J')
  })

  it('path-style http endpoint porttal és saját régióval (Garage-alak)', () => {
    const signed = signS3({
      method: 'PUT',
      key: "Csatorna/Cím (élő) – it's! [abcdefghijk].m4a",
      payloadHash: 'x'.repeat(64),
      now: new Date('2026-11-05T00:00:00Z'),
      config: { endpoint: 'http://garage:3900', region: 'garage', bucket: 'audio', pathStyle: true, accessKeyId: 'GK1', secretAccessKey: 's' },
    })
    expect(signed.headers.host).toBe('garage:3900')
    expect(signed.url).toBe('http://garage:3900/audio/Csatorna/C%C3%ADm%20%28%C3%A9l%C5%91%29%20%E2%80%93%20it%27s%21%20%5Babcdefghijk%5D.m4a')
    expect(signed.headers.authorization).toContain('Credential=GK1/20261105/garage/s3/aws4_request')
  })
})

describe('createS3Store', () => {
  const s3: Parameters<typeof createS3Store>[0] = {
    endpoint: 'http://garage:3900',
    region: 'garage',
    bucket: 'audio',
    pathStyle: true,
    accessKeyId: 'GK1',
    secretAccessKey: 's',
  }
  const urlOf = (input: Parameters<typeof fetch>[0]): string => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)

  it('a list lapoz, és dekódolja az XML-entitásokat', async () => {
    const urls: string[] = []
    const pages = [
      '<ListBucketResult><Contents><Key>A &amp; B [abcdefghijk].m4a</Key></Contents><IsTruncated>true</IsTruncated><NextContinuationToken>t&amp;1</NextContinuationToken></ListBucketResult>',
      '<ListBucketResult><Contents><Key>C [bcdefghijkl].m4a</Key></Contents><IsTruncated>false</IsTruncated></ListBucketResult>',
    ]
    const fetchImpl: typeof fetch = (input) => {
      urls.push(urlOf(input))
      return Promise.resolve(new Response(pages[urls.length - 1] ?? '', { status: 200 }))
    }
    const keys = await createS3Store(s3, fetchImpl).list('')
    expect(keys).toEqual(['A & B [abcdefghijk].m4a', 'C [bcdefghijkl].m4a'])
    expect(urls[1]).toContain('continuation-token=t%261')
  })

  it('a putFile fájlból streamel, content-lengthtel és a tartalom hash-ével', async () => {
    const dir = mkdtempSync(join(tmpdir(), 's3-'))
    const file = join(dir, 'f.txt')
    writeFileSync(file, 'felirat')
    let seen: RequestInit | undefined
    const fetchImpl: typeof fetch = (_input, init) => {
      seen = init
      return Promise.resolve(new Response('', { status: 200 }))
    }
    await createS3Store(s3, fetchImpl).putFile('k/f.txt', file)
    const headers = seen?.headers as Record<string, string>
    expect(headers['content-length']).toBe('7')
    expect(headers['x-amz-content-sha256']).toBe('596a51f53168cadf8af76759ff459b3b921a2ca55ec12a46a93a5ed8b9671aa6')
    expect(await new Response(seen?.body).text()).toBe('felirat')
    expect((seen as RequestInit & { duplex?: string }).duplex).toBe('half')
  })

  it('a putFile nem 2xx válaszra dob', async () => {
    const dir = mkdtempSync(join(tmpdir(), 's3-'))
    const file = join(dir, 'f.txt')
    writeFileSync(file, 'x')
    const fetchImpl: typeof fetch = () => Promise.resolve(new Response('', { status: 500 }))
    await expect(createS3Store(s3, fetchImpl).putFile('k', file)).rejects.toThrow()
  })
})
