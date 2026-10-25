import { compile } from '@mdx-js/mdx'
import { stringify } from 'yaml'
import { FRONTMATTER } from '../vault/lint.js'

/** A showroom `contract/mdx-components.json` alakja. */
export interface Contract {
  components: Record<
    string,
    { attributes: Record<string, { type: 'string' | 'enum'; values?: string[]; required: boolean }> }
  >
}

/**
 * A vault-törzset MDX-szé teszi: kódon kívül a `{`, `}` és `<` elé `\` kerül.
 * Kivétel a `<` után: az `<séma:…>` autolink közönséges link lesz, a `](<cél>)`
 * link-cél érintetlen, a soron belüli `<!-- … -->` kimarad.
 * Soronként halad; a kerítés (``` vagy ~~~) és a soron belüli kód érintetlen.
 * A behúzott kód MDX-ben nem kód, ott is escape kell. A többsoros soron belüli
 * kódot nem követi (ponytail: ritka; ha kell, a törzs egészén kell keresni).
 */
export function escapeMdx(body: string): string {
  let fence: { char: string; length: number } | null = null
  return body
    .split('\n')
    .map((line) => {
      const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
      if (fence !== null) {
        if (marker && marker[1]![0] === fence.char && marker[1]!.length >= fence.length && marker[2]!.trim() === '') {
          fence = null
        }
        return line
      }
      if (marker) {
        fence = { char: marker[1]![0]!, length: marker[1]!.length }
        return line
      }
      return escapeLine(line)
    })
    .join('\n')
}

function escapeLine(line: string): string {
  let out = ''
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (c === '\\' && i + 1 < line.length) {
      out += c + line[++i]! // már escape-elt jel
    } else if (c === '`') {
      const length = /^`+/.exec(line.slice(i))![0].length
      const close = line.indexOf('`'.repeat(length), i + length)
      // az egyező hosszú lezáró nélküli backtick sima szöveg
      const end = close === -1 ? i + length : close + length
      out += line.slice(i, end)
      i = end - 1
    } else if (c === '<') {
      const rest = line.slice(i)
      const target = out.endsWith('](') ? /^<[^<>\n]*>/.exec(rest) : null
      const comment = /^<!--.*?-->/.exec(rest)
      const autolink = /^<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>]*)>/.exec(rest)
      if (target) {
        out += target[0] // `[szöveg](<cél>)`: a cél a link része, nem JSX
      } else if (comment) {
        // a HTML-komment MDX-ben nem fordul le; escape-elve látható szöveg lenne (ponytail: csak az egysoros)
      } else if (autolink) {
        // `\<url>` a site-on törött link (a `>` a href-be kerül), ezért közönséges link lesz
        out += `[${autolink[1]!.replace(/[\\[\]{}<>*_`]/g, '\\$&')}](<${autolink[1]}>)`
      } else {
        out += '\\<'
        continue
      }
      i += (target ?? comment ?? autolink)![0].length - 1
    } else {
      out += c === '{' || c === '}' || c === '<' ? `\\${c}` : c
    }
  }
  return out
}

export function renderMdx(fields: Record<string, unknown>, body: string): string {
  return `---\n${stringify(fields, { lineWidth: 0 })}---\n\n${body}`
}

// a site lib/note-frontmatter.ts-ének átirata (f1d7f0d); a path a content/notes-hoz képest
const PATH = /^([^/]+)\/([^/.]+)\.([^/.]+)\.mdx$/
const LANGUAGES = ['hu', 'en']
const TRANSLATION_FIELDS = ['translation_of', 'source_language', 'source_generated_at']
const REQUIRED = ['item_id', 'title', 'kind', 'language', 'generated_at', 'source', 'origin']

/** A site buildjét megállító szabályok, előtte a kötelező mezők; `null`, ha rendben. */
export function frontmatterError(target: string, fields: Record<string, unknown>): string | null {
  for (const field of REQUIRED) {
    const value = fields[field]
    if (typeof value !== 'string' || value === '') return `${target}: hiányzik: ${field}`
  }
  const match = PATH.exec(target)
  if (!match) return `${target}: nem <tétel>/<fajta>.<nyelv>.mdx alakú`
  const [, itemId, kind, language] = match as unknown as [string, string, string, string]
  if (!LANGUAGES.includes(language)) {
    return `${target}: a nyelvi suffix (${language}) csak ${LANGUAGES.join(' vagy ')} lehet`
  }
  if (fields.item_id !== itemId) return `${target}: az item_id nem a mappa neve (${itemId})`
  if (fields.kind !== kind) return `${target}: a kind nem a fájlnév fajtája (${kind})`
  if (fields.language !== language) return `${target}: a language nem a fájlnév suffixe (${language})`
  const missing = TRANSLATION_FIELDS.filter((field) => fields[field] === undefined)
  if (missing.length > 0 && missing.length < TRANSLATION_FIELDS.length) {
    return `${target}: a ${TRANSLATION_FIELDS.join(', ')} csak együtt szerepelhet, hiányzik: ${missing.join(', ')}`
  }
  if (missing.length === 0 && fields.translation_of !== kind) {
    return `${target}: a translation_of nem a kind (${kind})`
  }
  return null
}

interface MdxNode {
  type: string
  name?: string | null
  attributes?: { type: string; name?: string; value?: unknown }[]
  children?: MdxNode[]
}

function nodeErrors(node: MdxNode, contract: Contract, errors: string[]): void {
  if (node.type === 'mdxFlowExpression' || node.type === 'mdxTextExpression' || node.type === 'mdxjsEsm') {
    errors.push(`${node.type === 'mdxjsEsm' ? 'import/export' : 'kifejezés'} nem engedett`)
  }
  if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
    const spec = node.name != null && Object.hasOwn(contract.components, node.name) ? contract.components[node.name] : undefined
    if (spec === undefined) {
      errors.push(`ismeretlen komponens: ${node.name ?? '<>'}`)
    } else {
      const given = new Set<string>()
      for (const attr of node.attributes ?? []) {
        const attrSpec =
          attr.type === 'mdxJsxAttribute' && Object.hasOwn(spec.attributes, attr.name!) ? spec.attributes[attr.name!] : undefined
        if (attrSpec === undefined) {
          errors.push(`${node.name}: nem engedett attribútum: ${attr.name ?? '{...}'}`)
        } else if (typeof attr.value !== 'string') {
          errors.push(`${node.name}.${attr.name}: csak string-literál lehet`)
        } else if (attrSpec.type === 'enum' && !attrSpec.values?.includes(attr.value)) {
          errors.push(`${node.name}.${attr.name}: nem engedett érték: ${attr.value}`)
        }
        if (attr.name) given.add(attr.name)
      }
      for (const [name, attrSpec] of Object.entries(spec.attributes)) {
        if (attrSpec.required && !given.has(name)) errors.push(`${node.name}: hiányzik a ${name} attribútum`)
      }
    }
  }
  for (const child of node.children ?? []) nodeErrors(child, contract, errors)
}

/** `compile` + komponens-ellenőrzés a szerződés szerint; üres lista = rendben. */
export async function mdxErrors(source: string, contract: Contract): Promise<string[]> {
  const errors: string[] = []
  try {
    await compile(source.replace(FRONTMATTER, ''), {
      remarkPlugins: [() => (tree: MdxNode) => nodeErrors(tree, contract, errors)],
    })
  } catch (e) {
    return [`nem fordul le: ${(e as Error).message.split('\n')[0]}`]
  }
  return errors
}
