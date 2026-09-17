import { z } from 'zod'
import { formatCriterion } from '../rubric/format.js'
import { coverageCriterion, pedagogicalFaithfulnessCriterion } from '../rubric/judge.js'
import { languageCriterion } from '../rubric/language.js'
import type { SourceItem } from '../types.js'
import { escapeHeadings, singleLine } from './markdown.js'
import { languageRule, pedagogicalRule, RULE } from './rules.js'
import { structuredOutput } from './structured.js'
import type { Recipe } from './types.js'

/**
 * A strukturált jegyzet sémája. A `diagram` kötelező, de üres lehet: a gateway
 * `strict: true` sémát kap, amiben az opcionális mező elutasítható.
 */
export const NotesSchema = z.object({
  summary: z.string().trim().min(1),
  /** Mermaid-forrás kerítés nélkül; üres string = nincs diagram. */
  diagram: z.string().trim(),
  concepts: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        definition: z.string().trim().min(1),
        explanation: z.string().trim().min(1),
        example: z.string().trim().min(1),
        variation: z.string().trim().min(1),
      }),
    )
    .min(3),
})

export type Notes = z.infer<typeof NotesSchema>

const FENCED = /^```[\w-]*[ \t]*\n([\s\S]*?)\n```$/

/**
 * A diagram forrása kerítés nélkül, vagy `null`, ha nincs diagram.
 *
 * Ha a modell a tiltás ellenére bekerítette, a kerítést leszedjük. Ha ezután is
 * marad benne kerítéssor, a diagram kimarad: egy félbevágott kerítés a
 * jegyzet hátralévő részét kódblokká tenné.
 */
export function diagramSource(raw: string): string | null {
  const trimmed = raw.trim()
  const fenced = FENCED.exec(trimmed)
  const source = (fenced ? fenced[1]! : trimmed).trim()
  if (source === '' || /^[ \t]*```/m.test(source)) return null
  return source
}

/** Táblázatcella: egy sorba, a `|` escape-pel — a futásriport tábláinak szabálya. */
function tableCell(text: string): string {
  return singleLine(text).replace(/\|/g, '\\|')
}

/**
 * Jegyzet → Markdown. A példa és a variáció címkéjét a renderer írja ki, és a
 * táblázat a fogalmakból épül: így a kötelező elemek nem a modell figyelmén
 * múlnak, és a bíró szabad zónája szerkezeti jelre támaszkodik.
 */
export function renderNotes(notes: Notes): string {
  const parts = [escapeHeadings(notes.summary)]

  const diagram = diagramSource(notes.diagram)
  if (diagram !== null) {
    parts.push('## Overview', ['```mermaid', diagram, '```'].join('\n'))
  }

  parts.push('## Key Concepts')
  for (const concept of notes.concepts) {
    parts.push(
      `### ${singleLine(concept.name)}`,
      escapeHeadings(concept.explanation),
      `**Example:** ${escapeHeadings(concept.example)}`,
      `**Variation:** ${escapeHeadings(concept.variation)}`,
    )
  }

  parts.push(
    '## Summary Table',
    [
      '| Term | Definition | Example |',
      '| --- | --- | --- |',
      ...notes.concepts.map(
        (c) => `| ${tableCell(c.name)} | ${tableCell(c.definition)} | ${tableCell(c.example)} |`,
      ),
    ].join('\n'),
  )

  return parts.join('\n\n')
}

/** A bíró a RENDERELT jegyzetet olvassa, ezért a renderer címkéivel szólunk. */
export const NOTES_FREE_PARTS =
  'every paragraph that starts with **Example:** or **Variation:**, and the Example column of the Summary Table'

const rules = (item: SourceItem): string =>
  [
    languageRule(item),
    pedagogicalRule('every example and every variation'),
    '- Pick 3 to 8 key concepts of the video.',
    '- summary: one sentence on what the video is about.',
    '- For each concept: a one-sentence definition, an explanation of two to four',
    '  sentences, a concrete example of one or two sentences, and a variation in the',
    '  form "What if …? → …".',
    '- diagram: Mermaid source (flowchart, sequenceDiagram or mindmap) when the content',
    '  has a process, a structure or relationships; otherwise an empty string. Write',
    '  the diagram source only, without a ``` fence.',
    RULE.noFrontmatter,
    RULE.noWikilinks,
  ].join('\n')

/**
 * Strukturált jegyzet: fogalmanként definíció, magyarázat, példa és variáció,
 * összefoglaló táblázat, és ahol a tartalom indokolja, Mermaid-diagram. A
 * `summary`-tól a példa, a variáció és a táblázat különbözteti meg.
 */
export const notesRecipe: Recipe = {
  id: 'notes',
  outputFile: '_notes.md',
  publishable: true,
  role: 'draft',
  maxIterations: 0,
  // Kezdőérték feltevésből (kb. 1200 szó a medián, 4050 szavas elemen); a
  // kalibráló futás (6. feladat) írja felül.
  outputRatio: 0.3,

  structured: structuredOutput(NotesSchema, renderNotes),

  prompt: ({ item, transcript }) =>
    [
      'Write structured study notes built on key concepts from the transcript of the video below.',
      '',
      'Rules:',
      rules(item),
      '',
      `Title: ${item.title}`,
      '',
      '--- TRANSCRIPT ---',
      transcript,
    ].join('\n'),

  repairPrompt: ({ item, transcript, previous, gaps }) =>
    [
      'Revise the notes below. A reviewer scored them against the transcript and',
      'listed concrete gaps. Fix every gap. Keep what already works — do not rewrite',
      'the notes wholesale.',
      '',
      'The original rules still apply:',
      rules(item),
      '',
      `Title: ${item.title}`,
      '',
      '--- GAPS TO FIX ---',
      ...gaps.map((gap) => `- ${gap}`),
      '',
      '--- CURRENT NOTES ---',
      previous,
      '',
      '--- TRANSCRIPT ---',
      transcript,
    ].join('\n'),

  rubric: {
    criteria: [
      formatCriterion,
      languageCriterion,
      pedagogicalFaithfulnessCriterion(NOTES_FREE_PARTS),
      coverageCriterion,
    ],
    // A két bíró-kritérium átlaga. Saját kapu nincs: a kötelező elemeket a
    // séma és a renderer garantálja.
    passThreshold: 0.8,
  },
}
