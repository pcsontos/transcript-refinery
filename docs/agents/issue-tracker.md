# Issue tracker: GitHub

Az **új** issue-k és specek a privát `pcsontos/issue-tracker` repóban vannak, `project-refinery` címkével. A régiek ebben a repóban (`pcsontos/transcript-refinery`) maradtak. Minden `gh issue` hívásnál add meg a repót.

## Conventions

- **Create an issue**: `gh issue create -R pcsontos/issue-tracker --label project-refinery --title "..." --body "..."`.
- **Read an issue**: `gh issue view <n> -R pcsontos/issue-tracker --json number,title,body,labels,comments`. Régi issue: `-R pcsontos/transcript-refinery`.
- **List issues**: `gh issue list -R pcsontos/issue-tracker --label project-refinery --state open`, valamint a régiekhez `-R pcsontos/transcript-refinery`.
- **Comment / label / close**: `gh issue comment|edit|close <n> -R pcsontos/issue-tracker …`.

## Hivatkozások

- A commitban és a PR-ben a hivatkozás teljes: `pcsontos/issue-tracker#N`. Egy puszta `#N` ennek a repónak a száma.

## Specek

- A superpowers-specek és -tervek fájlként: `~/github/pcsontos/issue-tracker/transcript-refinery/<ÉÉÉÉ-HH-NN>-<issue>-<téma>/spec.md` és `plan.md`.
- A `code-review` Spec-ágának add át ezt az útvonalat; a repó `docs/` mappájában nem találja meg.
- A régi specek és tervek: `docs/plans/` (archívum).
