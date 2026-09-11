import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { $fetch, setup } from '@nuxt/test-utils/e2e'

// Más környezet — hiányzó konfigurációs fájl —, ezért külön fájl, saját `setup()`-pal.
describe('API — hiányzó konfiguráció', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('../..', import.meta.url)),
    env: { REFINERY_CONFIG: '/nem/letezo/refinery.config.yaml' },
    setupTimeout: 300_000,
  })

  it('az áttekintő 500-as válasza a konfigurációs hibát nevezi meg', async () => {
    const error = await $fetch('/api/overview').catch((e: unknown) => e)
    expect((error as { statusCode?: number }).statusCode).toBe(500)
    expect((error as { data?: { message?: string } }).data?.message).toContain(
      'Nincs konfigurációs fájl: /nem/letezo/refinery.config.yaml',
    )
  })
})
