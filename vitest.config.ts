import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      'transcript-refinery/classify': fileURLToPath(new URL('./src/fetch/classify.ts', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'evals/**/*.test.ts', 'worker/**/*.test.ts'],
    environment: 'node',
    // A riport fejléce helyi időt ír (`src/run/report.ts`), tehát a szövege
    // időzónafüggő. Rögzített zóna nélkül a tesztje a futtató gépen múlna.
    // Nem UTC: nulla eltolás mellett a helyi idő és az UTC kimenete egybeesne,
    // és egy `toISOString()`-re való visszaesés észrevétlen maradna.
    env: { TZ: 'Europe/Budapest' },
  },
})
