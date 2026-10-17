import { AsyncLocalStorage } from 'node:async_hooks'

/** A recept leghosszabb futásideje, ha a config nem mond mást. */
export const DEFAULT_RECIPE_TIMEOUT_MINUTES = 25
/** Az életjel időköze, ha a config nem mond mást. */
export const DEFAULT_HEARTBEAT_MINUTES = 10

/**
 * A recept a korlát után leállt. Szándékosan sima `Error`, státuszkód nélkül:
 * a `retry.ts` `isTransient()`-je ezt véglegesnek minősíti, tehát a leállított
 * hívást nem próbálja újra (az újrapróba újra kifizettetné ugyanazt).
 */
export class RecipeTimeout extends Error {
  constructor(recipe: string, minutes: number) {
    super(`A(z) „${recipe}" recept ${minutes} perc után sem készült el, ezért leállt.`)
    this.name = 'RecipeTimeoutError'
  }
}

/**
 * Egy recept hívásainak közös állapota. A kliens ebből olvassa a megszakítás
 * jelét, és ide írja a már legenerált szöveget (az életjel szószámához).
 * Hatókörben él, hogy a `ModelClient` felülete ne változzon.
 */
export interface CallScope {
  signal: AbortSignal
  text: string
}

const storage = new AsyncLocalStorage<CallScope>()

export function inScope<T>(scope: CallScope, fn: () => Promise<T>): Promise<T> {
  return storage.run(scope, fn)
}

export function currentScope(): CallScope | undefined {
  return storage.getStore()
}
