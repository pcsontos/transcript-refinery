/**
 * Szavakra bontás összehasonlításhoz: kisbetűsítés, és minden, ami nem betű
 * vagy szám, elválasztó. Az írásjel így nem számít különbségnek — pontosan ez
 * kell, mert az enyhe szerkesztés főleg írásjelet tesz a szövegbe.
 *
 * A `\p{L}` és `\p{N}` — nem `\w` —, mert a `\w` az `u` jelölő mellett is csak
 * ASCII-betűt fed le, az ékezetes betűket elválasztónak vennénk.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '')
}
