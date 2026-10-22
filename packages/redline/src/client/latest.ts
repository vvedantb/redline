/**
 * Keeps only the latest of overlapping requests. `start` returns a check that stays true until
 * another request starts or `cancel` runs, so a slow, stale response is dropped instead of applied.
 */
export function latestOnly() {
  let current = 0;
  return {
    start: () => {
      const id = ++current;
      return () => id === current;
    },
    cancel: () => {
      current++;
    },
  };
}
