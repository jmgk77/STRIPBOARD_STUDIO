// Pareto frontier helper for multi-objective search (F4b). All objectives are MINIMISED.

/** True when `a` is at least as good as `b` on every key and strictly better on one. */
export function dominates(a, b, keys) {
  let strict = false;
  for (const k of keys) {
    if (a[k] > b[k]) return false;
    if (a[k] < b[k]) strict = true;
  }
  return strict;
}

/** Non-dominated subset of `items` over the given (minimised) keys. */
export function paretoFront(items, keys) {
  return items.filter((a) => !items.some((b) => b !== a && dominates(b, a, keys)));
}
