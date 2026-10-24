import { describe, expect, it } from 'vitest'
import { DEFAULT_CHUNK_WORDS, splitForTranslation } from './split.js'

const szavak = (n: number): string => Array.from({ length: n }, () => 'szó').join(' ')
/** `## <cím>` (2 szó) + egy n szavas bekezdés. */
const szakasz = (cim: string, n: number): string => `## ${cim}\n\n${szavak(n)}`

describe('splitForTranslation', () => {
  it('a küszöb alatt egy darab, változatlanul', () => {
    const body = szakasz('A', 4)
    expect(splitForTranslation(body, DEFAULT_CHUNK_WORDS)).toEqual([body])
  })

  it('fejlécnél vág, a szakaszokat a küszöbig egy darabba gyűjti', () => {
    const [a, b, c] = [szakasz('A', 4), szakasz('B', 4), szakasz('C', 4)]
    expect(splitForTranslation([a, b, c].join('\n\n'), 12)).toEqual([`${a}\n\n${b}`, c])
  })

  it('a küszöbnél hosszabb szakaszt bekezdéshatáron vágja, a fejléc az első bekezdésével marad', () => {
    const body = ['## Hosszú', szavak(5), szavak(5), szavak(5)].join('\n\n')
    expect(splitForTranslation(body, 8)).toEqual([`## Hosszú\n\n${szavak(5)}`, szavak(5), szavak(5)])
  })

  it('kódkerítés közepén nem vág, akkor sem, ha üres sor van benne', () => {
    const fence = '```mermaid\ngraph TD\n\nA --> B\n```'
    const chunks = splitForTranslation([szavak(3), fence, szavak(3)].join('\n\n'), 2)
    expect(chunks).toContain(fence)
  })

  it('táblázatot és összefüggő listát nem vág szét', () => {
    const table = '| a | b |\n|---|---|\n| c | d |\n| e | f |'
    const list = '- egy kettő három\n\n- négy öt hat\n\n  folytatás hét nyolc'
    const chunks = splitForTranslation([table, list].join('\n\n'), 3)
    expect(chunks).toEqual([table, list])
  })

  it('a közvetlenül fejléc után kezdődő laza listát sem vágja szét', () => {
    const list = '- w w w w\n\n- w w w w\n\n- w w w w'
    expect(splitForTranslation(`## Pontok\n\n${list}`, 8)).toEqual([`## Pontok\n\n${list}`])
    const nested = '1. w w w w\n\n   w w w w\n\n2. w w w w'
    expect(splitForTranslation(`## P\n\n${nested}`, 7)).toEqual([`## P\n\n${nested}`])
  })

  it('a fejléccel vagy bevezető mondattal egy részben kezdődő laza listát sem vágja szét', () => {
    const rest = '- w w w w\n\n- w w w w\n\n- w w w w'
    expect(splitForTranslation(`## H\n- w w w w\n\n${rest}`, 8)).toEqual([`## H\n- w w w w\n\n${rest}`])
    expect(splitForTranslation(`Bevezető:\n- w w w w\n\n${rest}`, 8)).toEqual([`Bevezető:\n- w w w w\n\n${rest}`])
  })

  it.each([
    ['több üres sor', `${szakasz('A', 5)}\n\n\n\n${szakasz('B', 5)}`],
    ['kódkerítés üres sorral', `${szakasz('A', 5)}\n\n\`\`\`\nx\n\n\ny\n\`\`\`\n\n${szakasz('B', 5)}`],
    ['záró sortörés', `${szakasz('A', 5)}\n`],
  ])('összefűzve betűre az eredeti (%s)', (_, body) => {
    expect(splitForTranslation(body, 4).join('\n\n')).toBe(body)
  })

  it('nem ad szó nélküli darabot', () => {
    const chunks = splitForTranslation(`\n\n${szakasz('A', 6)}\n\n${szakasz('B', 6)}`, 4)
    expect(chunks.every((chunk) => chunk.trim() !== '')).toBe(true)
  })
})
