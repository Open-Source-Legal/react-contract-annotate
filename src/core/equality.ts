/** Shallow equality helpers for comparing props before writing the store. */

/** Same length and the same elements by `Object.is`, in order. */
export function shallowEqualArrays<T>(
  a: readonly T[],
  b: readonly T[]
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) return false;
  }
  return true;
}

/** Same own enumerable keys with the same values by `Object.is`. */
export function shallowEqualObjects(
  a: object | null | undefined,
  b: object | null | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(b, key) &&
      Object.is(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key]
      )
  );
}
