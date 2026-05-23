const TEST_SIZE = 20;

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Largest-remainder method: allocate `total` seats across groups proportionally
 * to `sizes`. Returns an integer array summing to `total`. */
function largestRemainder(sizes, total) {
  const sum = sizes.reduce((s, n) => s + n, 0);
  if (sum === 0) return sizes.map(() => 0);
  const exact = sizes.map((s) => (s / sum) * total);
  const floors = exact.map((x) => Math.floor(x));
  let allocated = floors.reduce((s, n) => s + n, 0);
  const remainders = exact.map((x, i) => ({ i, frac: x - Math.floor(x) }));
  remainders.sort((a, b) => b.frac - a.frac);
  const result = floors.slice();
  let k = 0;
  while (allocated < total) {
    result[remainders[k % remainders.length].i] += 1;
    allocated += 1;
    k += 1;
  }
  return result;
}

/**
 * Pick TEST_SIZE questions proportionally across topics.
 * Returns a fresh shuffled array of question records.
 */
export function selectQuestions(allQuestions) {
  const byTopic = new Map();
  for (const q of allQuestions) {
    if (!byTopic.has(q.topic)) byTopic.set(q.topic, []);
    byTopic.get(q.topic).push(q);
  }
  const topics = Array.from(byTopic.keys());
  const sizes = topics.map((t) => byTopic.get(t).length);
  const quotas = largestRemainder(sizes, TEST_SIZE);
  const picked = [];
  topics.forEach((topic, idx) => {
    const n = quotas[idx];
    const shuffled = shuffle(byTopic.get(topic));
    picked.push(...shuffled.slice(0, n));
  });
  return shuffle(picked);
}

export { shuffle, TEST_SIZE };
