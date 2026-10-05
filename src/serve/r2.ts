import { createHash, createHmac } from 'node:crypto'

export interface ObjectStore {
  list(prefix: string): Promise<string[]>
  put(key: string, body: Uint8Array): Promise<void>
  get(key: string): Promise<Uint8Array | null>
}

export interface R2Config {
  accountId: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}

const EMPTY_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest()
}

function encodePath(key: string): string {
  return key.split('/').map((part) => encodeURIComponent(part)).join('/')
}

function amzDate(now: Date): { amz: string; stamp: string } {
  const amz = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return { amz, stamp: amz.slice(0, 8) }
}

function sign(input: {
  method: 'GET' | 'PUT' | 'HEAD'
  key: string
  body: Uint8Array
  now: Date
  config: R2Config
  query?: Record<string, string>
}): { url: string; headers: Record<string, string> } {
  const { method, key, body, now, config } = input
  const { amz, stamp } = amzDate(now)
  const payloadHash = body.byteLength === 0 ? EMPTY_HASH : sha256(body)
  const host = `${config.accountId}.r2.cloudflarestorage.com`
  const canonicalUri = key === '' ? `/${config.bucket}` : `/${config.bucket}/${encodePath(key)}`
  const canonicalQuery = Object.keys(input.query ?? {})
    .sort()
    .map((name) => `${encodeURIComponent(name)}=${encodeURIComponent(input.query?.[name] ?? '')}`)
    .join('&')
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amz}\n`
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join(
    '\n',
  )
  const scope = `${stamp}/auto/s3/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amz, scope, sha256(canonicalRequest)].join('\n')
  const signing = hmac(hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, stamp), 'auto'), 's3'), 'aws4_request')
  const signature = createHmac('sha256', signing).update(stringToSign).digest('hex')
  const url = `https://${host}${canonicalUri}${canonicalQuery === '' ? '' : `?${canonicalQuery}`}`
  return {
    url,
    headers: {
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amz,
      authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  }
}

export function signR2(input: {
  method: 'GET' | 'PUT' | 'HEAD'
  key: string
  body: Uint8Array
  now: Date
  config: R2Config
}): { url: string; headers: Record<string, string> } {
  return sign(input)
}

function keysFromList(xml: string): string[] {
  const keys: string[] = []
  for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) {
    if (match[1] !== undefined) keys.push(match[1])
  }
  return keys
}

export function createR2Store(config: R2Config, fetchImpl: typeof fetch = fetch, now: () => Date = () => new Date()): ObjectStore {
  async function call(method: 'GET' | 'PUT' | 'HEAD', key: string, body: Uint8Array, query?: Record<string, string>): Promise<Response> {
    const signed = sign({ method, key, body, now: now(), config, query })
    return fetchImpl(signed.url, {
      method,
      headers: signed.headers,
      body: method === 'PUT' ? body : undefined,
    })
  }

  return {
    async list(prefix: string): Promise<string[]> {
      const response = await call('GET', '', new Uint8Array(), { 'list-type': '2', prefix })
      if (!response.ok) throw new Error(`Az R2 lista nem sikerült: ${response.status}`)
      return keysFromList(await response.text())
    },
    async put(key: string, body: Uint8Array): Promise<void> {
      const response = await call('PUT', key, body)
      if (!response.ok) throw new Error(`Az R2 feltöltés nem sikerült: ${response.status}`)
    },
    async get(key: string): Promise<Uint8Array | null> {
      const response = await call('GET', key, new Uint8Array())
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`Az R2 olvasás nem sikerült: ${response.status}`)
      return new Uint8Array(await response.arrayBuffer())
    },
  }
}
