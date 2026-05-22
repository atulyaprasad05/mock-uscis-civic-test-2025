const STOPWORDS = new Set(["the", "a", "an"]);

export function normalize(s) {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[.,;:!?()\[\]"]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w && !STOPWORDS.has(w))
    .join(" ");
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = a.length, n = b.length;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

export function similarity(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return 1 - dist / maxLen;
}

const SHORT_LEN = 4;
const DEFAULT_THRESHOLD = 0.8;

export function bestMatchScore(input, candidates) {
  let best = 0;
  for (const c of candidates) {
    const s = similarity(input, c);
    if (s > best) best = s;
  }
  return best;
}

function isNumericToken(s) {
  return /^\d+$/.test(s);
}

export function isFuzzyMatch(input, candidates, threshold = DEFAULT_THRESHOLD) {
  const ni = normalize(input);
  if (!ni) return false;
  for (const c of candidates) {
    const nc = normalize(c);
    if (!nc) continue;
    if (ni === nc) return true;
    // Short-answer rule: if either side is short (e.g., "27"), require exact
    // match OR — if the short side is numeric — accept when it appears as a
    // whole token in the longer side. This handles cases like user typing
    // "27" against "twenty-seven 27".
    if (nc.length <= SHORT_LEN || ni.length <= SHORT_LEN) {
      const [shortS, longS] =
        ni.length <= SHORT_LEN ? [ni, nc] : [nc, ni];
      if (shortS === longS) return true;
      if (isNumericToken(shortS) && longS.split(" ").includes(shortS)) {
        return true;
      }
      continue;
    }
    const dist = levenshtein(ni, nc);
    const maxLen = Math.max(ni.length, nc.length);
    if (1 - dist / maxLen >= threshold) return true;
  }
  return false;
}
