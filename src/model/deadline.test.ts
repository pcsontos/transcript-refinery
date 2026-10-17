import { describe, expect, it } from 'vitest'
import { currentScope, inScope, RecipeTimeout, type CallScope } from './deadline.js'
import { isTransient } from './retry.js'

describe('inScope', () => {
  it('hatókörön kívül nincs aktuális hatókör', () => {
    expect(currentScope()).toBeUndefined()
  })

  it('az aszinkron hívásláncban is ugyanaz a hatókör látszik', async () => {
    const scope: CallScope = { signal: new AbortController().signal, text: '' }
    const seen = await inScope(scope, async () => {
      await Promise.resolve()
      return currentScope()
    })
    expect(seen).toBe(scope)
  })
})

describe('RecipeTimeout', () => {
  it('nem átmeneti hiba, és megnevezi a receptet és a percet', () => {
    const error = new RecipeTimeout('clean-deep', 40)
    expect(isTransient(error)).toBe(false)
    expect(error.message).toContain('„clean-deep"')
    expect(error.message).toContain('40 perc')
  })
})
