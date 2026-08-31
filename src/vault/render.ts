import { toParagraphs } from '../normalize/dedupe.js'
import type { NormalizedTranscript, SourceItem } from '../types.js'

/** YAML-biztos skalár: idézőjelezünk, ha a szöveg különleges karaktert tartalmaz. */
function yamlScalar(value: string): string {
  if (/^[\w .@-]+$/u.test(value)) return value
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * Normalizált átirat → vault-jegyzet. A frontmatter rögzíti a származást;
 * enélkül a későbbi mérés nem tudná, milyen minőségű bemeneten dolgozott.
 */
export function renderTranscriptNote(
  item: SourceItem,
  transcript: NormalizedTranscript,
  generatorVersion: string,
): string {
  const source =
    transcript.captionSource === 'creator' ? 'creator_captions' : 'auto_captions'

  const frontmatter = [
    '---',
    `video_id: ${yamlScalar(item.videoId)}`,
    `title: ${yamlScalar(item.title)}`,
    `channel: ${yamlScalar(item.channel)}`,
    `uploaded: ${yamlScalar(item.uploadedAt)}`,
    `url: ${yamlScalar(item.url)}`,
    `transcript_source: ${source}`,
    'transcript_model: null',
    `words_raw: ${transcript.wordsRaw}`,
    `words_normalized: ${transcript.wordsNormalized}`,
    `punctuation_density: ${transcript.punctuationDensity.toFixed(2)}`,
    `generated_at: ${new Date().toISOString()}`,
    `generator: transcript-refinery@${generatorVersion}`,
    '---',
  ].join('\n')

  const body = [
    '',
    `# ${item.title}`,
    '',
    `🌐 <${item.url}>`,
    '',
    '---',
    '',
    toParagraphs(transcript.lines),
    '',
  ].join('\n')

  return frontmatter + body
}
