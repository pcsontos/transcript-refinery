import { type Config, loadModelConfig, type ModelConfig } from '../config.js'
import { createModelClient, type ModelClient } from '../model/client.js'
import { createCostGuard } from '../model/budget.js'
import { modelConfigFor } from '../model/recipe-model.js'
import { retrying } from '../model/retry.js'
import { splitForTranslation } from '../recipe/split.js'
import { type Contract, escapeMdx, mdxErrors, splitHeader } from './mdx.js'
import type { SiteLanguage } from './variant.js'
import { takeIntro, verbatimError } from './verbatim.js'

export type TransformResult =
  | { kind: 'final'; body: string }
  | { kind: 'failed'; reason: string } // két próba után is elbukott
  | { kind: 'budget' } // a plafon miatt nem hívott modellt

export interface TransformUsage {
  inputTokens: number
  outputTokens: number
  usd: number
  budgetSkipped: number
}

/** Az LLM-es átalakító (#278): vault-törzsből `.mdx`-törzs. A frontmattert nem írja. */
export interface Transform {
  run(input: { siteKind: string; body: string; language: SiteLanguage; contract: Contract }): Promise<TransformResult>
  usage(): TransformUsage
}

export const MDX_MODEL_KEY = 'mdx'
export const MDX_CHUNK_WORDS = 8000
export const INTRO_TITLES: Record<SiteLanguage, string> = { hu: 'Röviden', en: 'In brief' }

const LANGUAGE_NAMES: Record<SiteLanguage, string> = { hu: 'Hungarian', en: 'English' }
const ATTEMPTS = 2
const ALLOWED_ATTRIBUTES = ['title', 'type']

/**
 * A szó szerinti ellenőrzés elől elrejtett új tartalom: a `title`/`type`-on kívüli attribútum
 * (pl. `Card description`, `href`), kép, link-referencia-definíció, ha az eredetiben nincs.
 */
function forbiddenError(original: string, output: string): string | null {
  const prose = output.replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[ \t]*$/gm, '')
  for (const tag of prose.matchAll(/<([A-Z][\w.]*)((?:\s+[\w-]+(?:="[^"]*")?)*)\s*\/?>/g)) {
    for (const attr of tag[2]!.matchAll(/\s([\w-]+)(?:="[^"]*")?/g)) {
      if (!ALLOWED_ATTRIBUTES.includes(attr[1]!)) return `${tag[1]}: nem engedett attribútum: ${attr[1]} (csak ${ALLOWED_ATTRIBUTES.join(', ')})`
    }
  }
  if (/!\[/.test(prose) && !/!\[/.test(original)) return 'új kép nem engedett'
  if (/^\s*\[[^\]]+\]:\s/m.test(prose) && !/^\s*\[[^\]]+\]:\s/m.test(original)) return 'új link-referencia-definíció nem engedett'
  return null
}

function componentLines(contract: Contract): string {
  return Object.entries(contract.components)
    .map(([name, { attributes }]) => {
      const attrs = Object.entries(attributes).map(
        ([attr, spec]) => `${attr} (${spec.type === 'enum' ? spec.values!.join(', ') : 'string'}, ${spec.required ? 'required' : 'optional'})`,
      )
      return `- ${name}: ${attrs.length > 0 ? attrs.join(', ') : 'no attributes'}`
    })
    .join('\n')
}

export function mdxPrompt(input: {
  text: string
  language: SiteLanguage
  contract: Contract
  intro: 'inline' | 'none' | 'only'
  part?: { index: number; total: number }
  error?: string
}): string {
  const { text, language, contract, intro, part, error } = input
  const callout = `<Callout type="note" title="${INTRO_TITLES[language]}">`
  const introText = `a short introduction in ${LANGUAGE_NAMES[language]} to the whole text below (what it is about and what the reader takes away), a few sentences or 3–5 bullet points`
  const rules =
    intro === 'only'
      ? `Write only one ${callout} block: ${introText}. Output nothing else.`
      : [
          'Restructure the Markdown note below into an MDX page that is easy to read on the web.',
          '',
          'Hard rules:',
          '- Keep every word of the text, in the same order. Do not rephrase, shorten, merge, summarize, drop or add any sentence.',
          '- You may only add structure: ## and ### headings, paragraph breaks (split long paragraphs into 1–3 sentence paragraphs), **bold** and *italic*, turning text that already is a list or a sequence of steps into a list or <Steps>, and component titles.',
          '- Keep existing headings as headings with their exact text; you may change their level.',
          '- Bold sparingly: a few key sentences or facts per section, not every other sentence.',
          '- Actively use the components below to make the page scannable. Plain paragraphs and headings alone are not enough: a page of any length should use several of them, wherever the text has the matching shape:',
          '  - a sequence of steps, a process or a chronology (eras, stages, phases) in order → <Steps> with one <Step> per item;',
          '  - a set of named things (concepts, roles, tools, options, levels) → <Cards> with one <Card title="…"> per item, holding that item\'s text;',
          '  - a side detail, an aside, or a question with its answer → <Accordions> with <Accordion title="…">. Never collapse the main message or the core content of the page into an accordion;',
          '  - two or more parallel alternatives to compare (not a sequence) → <Tabs> with <Tab title="…">;',
          '  - a key takeaway or a tip → <Callout type="tip" title="…">; <Callout type="warning"> only for an actual warning, caution or pitfall in the text.',
          '- A component only wraps text that is already there, in the original order: move no sentence out of place and write no new sentence inside a component. Its title attribute may be a new short label; do not repeat the title as a heading inside the component. Leave a blank line between a component tag and the Markdown inside it.',
          '- Allowed components and attributes (string literal values only):',
          componentLines(contract),
          '- Use only the title and type attributes of components, never href or description. No images, no link reference definitions, no import/export, no {…} expressions, no raw HTML.',
          '- Escape { } and < in text as \\{ \\} \\<. Leave fenced code blocks exactly as they are. Write <https://…> links as [https://…](<https://…>).',
          '- Output only the MDX. Do not wrap it in a code fence.',
          intro === 'inline'
            ? `- Start with exactly one ${callout} block: ${introText.replace(' to the whole text below', '')}. This is the only place where new sentences are allowed. Then the restructured text.`
            : '- Do not add an introduction.',
        ].join('\n')
  return [
    rules,
    ...(part ? [`This is part ${part.index} of ${part.total} of a longer note.`] : []),
    ...(error ? [`Your previous answer was rejected: ${error}. Fix this and follow the rules exactly.`] : []),
    '',
    '--- NOTE ---',
    text,
  ].join('\n')
}

export function createMdxTransform(deps: { client: ModelClient; modelConfig: ModelConfig; chunkWords?: number }): Transform {
  const { client, modelConfig } = deps
  const chunkWords = deps.chunkWords ?? MDX_CHUNK_WORDS
  const guard = createCostGuard(modelConfig.costLimitUsd)
  const usage = { inputTokens: 0, outputTokens: 0, budgetSkipped: 0 }

  /** Egy egység (darab vagy bevezető) legfeljebb két próbával; `check` a hibaleírást adja vagy `null`-t. */
  async function attempt(
    prompt: (error?: string) => string,
    check: (output: string) => Promise<string | null>,
  ): Promise<{ ok: true; output: string } | { ok: false; reason: string }> {
    let error: string | undefined
    for (let i = 0; i < ATTEMPTS; i++) {
      const reply = await client.generate('draft', prompt(error))
      guard.add('draft', reply.usage, modelConfig)
      usage.inputTokens += reply.usage.inputTokens
      usage.outputTokens += reply.usage.outputTokens
      error = (await check(reply.value)) ?? undefined
      if (error === undefined) return { ok: true, output: reply.value }
    }
    return { ok: false, reason: error! }
  }

  const base = (language: SiteLanguage, contract: Contract) => ({ language, contract })

  return {
    async run({ body, language, contract }) {
      if (guard.exceeded()) {
        usage.budgetSkipped++
        return { kind: 'budget' }
      }
      const { header, rest } = splitHeader(body)
      const chunks = splitForTranslation(rest, chunkWords)
      if (chunks.length === 0) return { kind: 'failed', reason: 'üres törzs' }
      const title = INTRO_TITLES[language]
      const callout = (intro: string) => `<Callout type="note" title="${title}">\n${intro}\n</Callout>`
      const compile = async (output: string) => (await mdxErrors(output, contract))[0] ?? null
      const sections: string[] = []

      if (chunks.length === 1) {
        const text = chunks[0]!
        let intro = ''
        const done = await attempt(
          (error) => mdxPrompt({ text, ...base(language, contract), intro: 'inline', error }),
          async (output) => {
            const taken = takeIntro(output, title)
            if (taken === null) return `hiányzik a(z) „${title}” című bevezető blokk az elején`
            intro = taken.intro
            return (await compile(output)) ?? forbiddenError(text, output) ?? verbatimError(text, taken.rest)
          },
        )
        if (!done.ok) return { kind: 'failed', reason: done.reason }
        sections.push(callout(intro), takeIntro(done.output, title)!.rest)
      } else {
        const parts: string[] = []
        for (const [i, text] of chunks.entries()) {
          const done = await attempt(
            (error) =>
              mdxPrompt({ text, ...base(language, contract), intro: 'none', part: { index: i + 1, total: chunks.length }, error }),
            async (output) => (await compile(output)) ?? forbiddenError(text, output) ?? verbatimError(text, output),
          )
          if (!done.ok) return { kind: 'failed', reason: done.reason }
          parts.push(done.output.trim())
        }
        let intro = ''
        const done = await attempt(
          (error) => mdxPrompt({ text: rest, ...base(language, contract), intro: 'only', error }),
          async (output) => {
            const taken = takeIntro(output, title)
            if (taken === null) return `hiányzik a(z) „${title}” című bevezető blokk`
            if (taken.rest !== '') return 'a bevezető blokkon kívül más is van a kimenetben'
            intro = taken.intro
            return (await compile(output)) ?? forbiddenError(rest, output)
          },
        )
        if (!done.ok) return { kind: 'failed', reason: done.reason }
        sections.push(callout(intro), ...parts)
      }
      return { kind: 'final', body: [escapeMdx(header), ...sections].filter((s) => s !== '').join('\n\n') + '\n' }
    },
    usage: () => ({ ...usage, usd: guard.spentUsd() }),
  }
}

/** Az átalakító a configból; `string`, ha nincs (az ok a `loadModelConfig` hibájának első sora). */
export function mdxTransformFor(
  raw: unknown,
  cfg: Config,
  createClient: (cfg: ModelConfig) => ModelClient = createModelClient,
): Transform | string {
  let view: ModelConfig
  try {
    view = modelConfigFor(loadModelConfig(raw, process.env, cfg.configPath), MDX_MODEL_KEY)
  } catch (error) {
    return (error as Error).message.split('\n')[0]!
  }
  return createMdxTransform({ client: retrying(createClient(view)), modelConfig: view })
}
