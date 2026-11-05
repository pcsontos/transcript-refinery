import { createHash, createHmac } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'

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

function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest()
}

export interface S3Config {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  pathStyle: boolean
}

export interface S3Store extends ObjectStore {
  putFile(key: string, path: string): Promise<void>
}

/** RFC 3986 szerinti kódolás: az encodeURIComponent a !'()* karaktereket nem kódolja. */
function encode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

function encodePath(key: string): string {
  return key.split('/').map(encode).join('/')
}

function amzDate(now: Date): { amz: string; stamp: string } {
  const amz = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return { amz, stamp: amz.slice(0, 8) }
}

export function r2S3Config(config: R2Config): S3Config {
  return {
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    region: 'auto',
    bucket: config.bucket,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    pathStyle: true,
  }
}

export function signS3(input: {
  method: 'GET' | 'PUT' | 'HEAD'
  key: string
  payloadHash: string
  now: Date
  config: S3Config
  query?: Record<string, string>
}): { url: string; headers: Record<string, string> } {
  const { method, key, payloadHash, now, config } = input
  const { amz, stamp } = amzDate(now)
  const endpoint = new URL(config.endpoint)
  const host = config.pathStyle ? endpoint.host : `${config.bucket}.${endpoint.host}`
  const canonicalUri = config.pathStyle
    ? key === ''
      ? `/${encode(config.bucket)}`
      : `/${encode(config.bucket)}/${encodePath(key)}`
    : key === ''
      ? '/'
      : `/${encodePath(key)}`
  const canonicalQuery = Object.keys(input.query ?? {})
    .sort()
    .map((name) => `${encode(name)}=${encode(input.query?.[name] ?? '')}`)
    .join('&')
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amz}\n`
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const scope = `${stamp}/${config.region}/s3/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amz, scope, sha256(canonicalRequest)].join('\n')
  const signing = hmac(hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, stamp), config.region), 's3'), 'aws4_request')
  const signature = createHmac('sha256', signing).update(stringToSign).digest('hex')
  const url = `${endpoint.protocol}//${host}${canonicalUri}${canonicalQuery === '' ? '' : `?${canonicalQuery}`}`
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
  return signS3({ method: input.method, key: input.key, payloadHash: sha256(input.body), now: input.now, config: r2S3Config(input.config) })
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_all, name: string) => {
    if (name.startsWith('#x')) return String.fromCodePoint(parseInt(name.slice(2), 16))
    if (name.startsWith('#')) return String.fromCodePoint(parseInt(name.slice(1), 10))
    return ENTITIES[name] ?? ''
  })
}

function keysFromList(xml: string): string[] {
  const keys: string[] = []
  for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) {
    if (match[1] !== undefined) keys.push(decodeXml(match[1]))
  }
  return keys
}

async function fileHash(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

export function createS3Store(config: S3Config, fetchImpl: typeof fetch = fetch, now: () => Date = () => new Date()): S3Store {
  async function call(
    method: 'GET' | 'PUT',
    key: string,
    payloadHash: string,
    query?: Record<string, string>,
    extra: RequestInit & { duplex?: 'half' } = {},
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> {
    const signed = signS3({ method, key, payloadHash, now: now(), config, query })
    return fetchImpl(signed.url, { method, ...extra, headers: { ...signed.headers, ...extraHeaders } })
  }

  return {
    async list(prefix: string): Promise<string[]> {
      const keys: string[] = []
      let token: string | undefined
      for (;;) {
        const query: Record<string, string> = { 'list-type': '2', prefix }
        if (token !== undefined) query['continuation-token'] = token
        const response = await call('GET', '', sha256(''), query)
        if (!response.ok) throw new Error(`Az S3 lista nem sikerült: ${response.status}`)
        const xml = await response.text()
        keys.push(...keysFromList(xml))
        const next = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1]
        if (!xml.includes('<IsTruncated>true</IsTruncated>') || next === undefined) return keys
        token = decodeXml(next)
      }
    },
    async put(key: string, body: Uint8Array): Promise<void> {
      const response = await call('PUT', key, sha256(body), undefined, { body })
      if (!response.ok) throw new Error(`Az S3 feltöltés nem sikerült: ${response.status}`)
    },
    async putFile(key: string, path: string): Promise<void> {
      const hash = await fileHash(path)
      const size = (await stat(path)).size
      const response = await call(
        'PUT',
        key,
        hash,
        undefined,
        { body: Readable.toWeb(createReadStream(path)), duplex: 'half' },
        { 'content-length': String(size) },
      )
      if (!response.ok) throw new Error(`Az S3 feltöltés nem sikerült: ${response.status}`)
    },
    async get(key: string): Promise<Uint8Array | null> {
      const response = await call('GET', key, sha256(''))
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`Az S3 olvasás nem sikerült: ${response.status}`)
      return new Uint8Array(await response.arrayBuffer())
    },
  }
}

export function createR2Store(config: R2Config, fetchImpl: typeof fetch = fetch, now: () => Date = () => new Date()): ObjectStore {
  return createS3Store(r2S3Config(config), fetchImpl, now)
}
