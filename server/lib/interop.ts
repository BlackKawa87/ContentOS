/**
 * Some CJS packages (yt-dlp-wrap, pptxgenjs) get inconsistently unwrapped when
 * imported via `import X from '...'` under tsx/Node ESM interop — sometimes
 * you get the class, sometimes the whole module object, sometimes a
 * double-wrapped `{ default: { default: Class } }`. Peel off `.default`
 * layers until we hit something that isn't a plain wrapper object anymore.
 */
export function unwrapDefault<T>(mod: unknown): T {
  let current = mod
  while (
    typeof current === 'object' &&
    current !== null &&
    'default' in current &&
    typeof (current as { default: unknown }).default !== 'undefined'
  ) {
    current = (current as { default: unknown }).default
  }
  return current as T
}
