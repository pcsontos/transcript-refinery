import { describe, expect, it } from 'vitest'
import { classifyInput } from './classify.js'

const video = (id: string) => ({
  kind: 'video' as const,
  id,
  url: `https://www.youtube.com/watch?v=${id}`,
})

describe('classifyInput', () => {
  it('a watch cím videó', () => {
    expect(classifyInput('https://www.youtube.com/watch?v=abcdefghijk', false)).toEqual(
      video('abcdefghijk'),
    )
  })

  it('a watch?v=&list= cím alapból csak a videó', () => {
    expect(
      classifyInput('https://www.youtube.com/watch?v=abcdefghijk&list=PLcourse123', false),
    ).toEqual(video('abcdefghijk'))
  })

  it('a --yes-playlist a watch?v=&list= címet listának veszi', () => {
    expect(
      classifyInput(' https://music.youtube.com/watch?v=abcdefghijk&list=PLcourse123 ', true),
    ).toEqual({
      kind: 'playlist',
      id: 'PLcourse123',
      url: 'https://music.youtube.com/watch?v=abcdefghijk&list=PLcourse123',
    })
  })

  it('a playlist útvonal és a list= v= nélkül lista', () => {
    expect(
      classifyInput('https://www.youtube.com/playlist?list=PLcourse123', false).kind,
    ).toBe('playlist')
  })

  it('a youtu.be, a shorts, az embed és a csupasz azonosító videó', () => {
    expect(classifyInput('https://youtu.be/abcdefghijk?t=3', false)).toEqual(video('abcdefghijk'))
    expect(classifyInput('https://www.youtube.com/shorts/abcdefghijk', false)).toEqual(
      video('abcdefghijk'),
    )
    expect(classifyInput('https://www.youtube-nocookie.com/embed/abcdefghijk', false)).toEqual(
      video('abcdefghijk'),
    )
    expect(classifyInput('abcdefghijk', false)).toEqual(video('abcdefghijk'))
  })

  it('a --yes-playlist lista nélkül videó marad', () => {
    expect(classifyInput('https://www.youtube.com/watch?v=abcdefghijk', true)).toEqual(
      video('abcdefghijk'),
    )
  })

  it('a 11-től eltérő v= és az idegen host elutasítás', () => {
    expect(classifyInput('https://www.youtube.com/watch?v=rovid', false)).toEqual({
      kind: 'rejected',
      raw: 'https://www.youtube.com/watch?v=rovid',
    })
    expect(classifyInput('https://vimeo.com/123456789', false).kind).toBe('rejected')
    expect(classifyInput('   ', false)).toEqual({ kind: 'rejected', raw: '' })
  })
})
