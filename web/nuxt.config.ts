import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// A repó gyökere: a `web/` szülőmappája. Build-időben rögzül, így a szerver a
// munkakönyvtártól függetlenül ugyanazt a konfigurációt és állapottárat látja,
// mint a gyökérből futtatott CLI.
const repoRoot = fileURLToPath(new URL('..', import.meta.url))

// A web az image-ben épül, így a build idején beolvasott szám a futó image verziója.
const { version } = JSON.parse(
  readFileSync(new URL('package.json', import.meta.url), 'utf8'),
) as { version: string }

export default defineNuxtConfig({
  compatibilityDate: '2026-09-11',
  modules: ['@nuxt/ui', '@nuxt/eslint'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  telemetry: false,
  // A felület kifelé nem hív: font nem töltődik le, az ikonok a helyi
  // `@iconify-json/lucide` csomagból jönnek.
  ui: { fonts: false },
  runtimeConfig: { refineryRoot: repoRoot, public: { appVersion: version } },
  // A `node:sqlite` Node-beépített modul: külsőként jelölve a build nem
  // figyelmeztet rá.
  nitro: { rollupConfig: { external: ['node:sqlite'] } },
})
