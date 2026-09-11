import MarkdownIt from 'markdown-it'

// A jegyzet modell írta szöveg: nyers HTML nem kerülhet belőle az oldalba. A
// `html: false` itt kifejezetten áll, mert ez a biztonsági pont — teszt őrzi.
const markdown = new MarkdownIt({ html: false, linkify: false })

export function renderMarkdown(source: string): string {
  return markdown.render(source)
}
