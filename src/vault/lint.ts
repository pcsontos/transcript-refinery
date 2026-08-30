const WIKILINK = /\[\[[^\]]+\]\]/g
const MARKDOWN_LINK = /!?\[[^\]]*\]\(([^)]*)\)/g

/**
 * A vault írási szabályai invariánsok, nem konvenciók: wikilink tilos, és
 * minden link célja szögletes zárójelben áll. Hibalistát ad; üres lista = jó.
 */
export function lintVaultMarkdown(md: string): string[] {
  const errors: string[] = []

  for (const m of md.matchAll(WIKILINK)) {
    errors.push(`wikilink tiltott: ${m[0]}`)
  }

  for (const m of md.matchAll(MARKDOWN_LINK)) {
    const dest = m[1]!
    if (!(dest.startsWith('<') && dest.endsWith('>'))) {
      errors.push(`a link célja nem szögletes zárójelben áll: ${m[0]}`)
    }
  }

  return errors
}
