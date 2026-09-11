import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Minden e2e-tesztfájl saját szervert fordít és indít: egymás után futnak.
    fileParallelism: false,
    hookTimeout: 300_000,
    testTimeout: 60_000,
  },
})
