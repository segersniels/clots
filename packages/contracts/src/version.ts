/** Tells whether version `a` is newer than version `b`. Both have the form `1.2.3`. */
export const isNewerVersion = (a: string, b: string) => {
  const [left, right] = [a, b].map((version) => version.split(".").map(Number));

  for (let index = 0; index < 3; index++) {
    const difference = (left?.[index] ?? 0) - (right?.[index] ?? 0);

    if (difference !== 0) return difference > 0;
  }

  return false;
};
