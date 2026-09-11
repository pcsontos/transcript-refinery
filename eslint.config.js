import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', '.state/', 'web/'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // A gyökérszintű konfigfájlok (vitest, eslint, bumpp) szándékosan
        // kimaradnak a `tsconfig.json`-ból — a `rootDir: "src"` miatt a build
        // hasalna el tőlük. A típusellenőrzött szabályokhoz viszont projekt
        // kell, ezt adja nekik az alapértelmezett projekt.
        projectService: {
          allowDefaultProject: ['*.ts', '*.js'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // A `noUncheckedIndexedAccess` miatt a tömbindexelés `T | undefined`-ot
      // ad, ezért a `!` itt a szándék kifejezése, nem elhanyagolás.
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Az alulvonással kezdődő paraméter szándékosan kihasználatlan.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
)
