import { describe, expect, it } from 'vitest'
import { commandServe } from './command.js'

describe('commandServe környezeti változók ellenőrzése', () => {
  it('hiányzó kötelező változóknál 1-gyel tér vissza', async () => {
    const code = await commandServe({})
    expect(code).toBe(1)
  })

  it('érvénytelen SERVE_PORT esetén 1-gyel tér vissza', async () => {
    const code = await commandServe({
      REFINERY_SERVE_SECRET: 'test-secret',
      WORKER_CALLBACK_URL: 'http://localhost',
      SERVE_OUT: '/tmp',
      SERVE_PORT: 'invalid',
      R2_ACCOUNT_ID: 'acc',
      R2_BUCKET: 'bkt',
      R2_ACCESS_KEY_ID: 'key',
      R2_SECRET_ACCESS_KEY: 'sec',
    })
    expect(code).toBe(1)
  })
})
