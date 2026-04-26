import { ORPHAN_COLOR, SEED_COLORS, type ClusterInfo } from "@/lib/graph";
import type { ResearchPaper, Subtopic } from "@/lib/papers";

type Vector = number[];

/**
 * --- clustering config ---
 */
export function estimateClustersByPaperCount(totalPapers: number): number {
  return Math.floor(totalPapers / 15);
}

function computeClusterCount(totalPapers: number): number {
  const raw = estimateClustersByPaperCount(totalPapers);
  return Math.max(1, Math.min(raw, totalPapers));
}

/**
 * --- simple title vectorization ---
 */
const STOP_WORDS = new Set([
  "a","an","the","and","or","of","for","with","in","on","to","from",
  "by","using","via","toward","towards","approach","method","methods",
  "based","study","analysis","system","systems","model","models","paper",
]);

function tokenizeTitle(title: string): string[] {
  const tokens = title.toLowerCase().match(/[a-z][a-z0-9-]+/g) ?? [];
  return tokens.filter(t => t.length >= 3 && !STOP_WORDS.has(t));
}

function normalize(v: Vector): Vector {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  if (norm === 0) return v.slice();
  const denom = Math.sqrt(norm);
  return v.map(x => x / denom);
}

class TitleVectorStore {
  vocabulary: string[];
  vectorsByPaperId: Map<string, Vector>;

  constructor(papers: ResearchPaper[]) {
    const vocabSet = new Set<string>();
    const tokenMap = new Map<string, string[]>();

    for (const p of papers) {
      const tokens = tokenizeTitle(p.title ?? "");
      tokenMap.set(p.id, tokens);
      for (const t of tokens) vocabSet.add(t);
    }

    this.vocabulary = [...vocabSet].sort();
    this.vectorsByPaperId = new Map();

    for (const p of papers) {
      const tokens = tokenMap.get(p.id) ?? [];
      const freq = new Map<string, number>();

      for (const t of tokens) {
        freq.set(t, (freq.get(t) ?? 0) + 1);
      }

      const vector = this.vocabulary.map(t => freq.get(t) ?? 0);
      this.vectorsByPaperId.set(p.id, normalize(vector));
    }
  }

  getVector(id: string): Vector {
    return this.vectorsByPaperId.get(id) ?? this.vocabulary.map(() => 0);
  }
}

/**
 * --- cosine similarity ---
 */
function cosineSimilarity(a: Vector, b: Vector): number {
  let dot = 0, aNorm = 0, bNorm = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aNorm += a[i] * a[i];
    bNorm += b[i] * b[i];
  }

  if (aNorm === 0 || bNorm === 0) return 0;
  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}

/**
 * --- k-means (seed-initialized centroids) ---
 */
function kMeansCosine(
  vectors: Vector[],
  seedVectors: Vector[],
  k: number,
  maxIterations = 25
): number[] {
  if (vectors.length === 0) return [];

  const assignments = new Array(vectors.length).fill(0);

  //CENTROIDS COME FROM SEED PAPERS
  const centroids: Vector[] = seedVectors
    .slice(0, k)
    .map(v => v.slice());

  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;

    // assign
    for (let i = 0; i < vectors.length; i++) {
      let best = 0;
      let bestScore = -Infinity;

      for (let c = 0; c < k; c++) {
        const score = cosineSimilarity(vectors[i], centroids[c]);
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }

      if (assignments[i] !== best) {
        assignments[i] = best;
        changed = true;
      }
    }

    // recompute centroids
    const sums: Vector[] = Array.from({ length: k }, () =>
      new Array(vectors[0].length).fill(0)
    );
    const counts = new Array(k).fill(0);

    for (let i = 0; i < vectors.length; i++) {
      const c = assignments[i];
      counts[c]++;

      for (let d = 0; d < vectors[i].length; d++) {
        sums[c][d] += vectors[i][d];
      }
    }

    for (let c = 0; c < k; c++) {
      if (!counts[c]) continue;

      const mean = sums[c].map(v => v / counts[c]);
      centroids[c] = normalize(mean);
    }

    if (!changed) break;
  }

  return assignments;
}

/**
 * --- label clusters ---
 */
function labelFromClusterTitles(titles: string[]): string {
  const counts = new Map<string, number>();

  for (const t of titles) {
    const tokens = new Set(tokenizeTitle(t));
    for (const tok of tokens) {
      counts.set(tok, (counts.get(tok) ?? 0) + 1);
    }
  }

  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t]) => t);

  if (!top.length) return "Related Work";
  return top.map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
}

/**
 * --- MAIN ---
 */
export async function clusterPapersWithTitleVectors(
  _query: string,
  seeds: ResearchPaper[],
  citations: ResearchPaper[],
): Promise<ClusterInfo | null> {

  const allPapers = [...seeds, ...citations];
  if (!allPapers.length) return null;

  const rawK = computeClusterCount(allPapers.length);
  const k = Math.min(rawK, seeds.length || 1);

  const vectorStore = new TitleVectorStore(allPapers);

  const vectors = allPapers.map(p =>
    vectorStore.getVector(p.id)
  );

  const seedVectors = seeds.map(p =>
    vectorStore.getVector(p.id)
  );

  const assignments = kMeansCosine(vectors, seedVectors, k);

  const buckets = new Map<number, ResearchPaper[]>();

  for (let i = 0; i < allPapers.length; i++) {
    const c = assignments[i] ?? 0;
    if (!buckets.has(c)) buckets.set(c, []);
    buckets.get(c)!.push(allPapers[i]);
  }

  const sortedClusters = [...buckets.entries()].sort(
    (a, b) => b[1].length - a[1].length
  );

  const seedSet = new Set(seeds.map(s => s.id));

  const colorBySeed = new Map<string, string>();
  const colorByChild = new Map<string, string>();
  const clusterIdxBySeed = new Map<string, number>();
  const clusterIdxByChild = new Map<string, number>();

  const subtopics: Subtopic[] = [];

  for (let i = 0; i < sortedClusters.length; i++) {
    const [_, papers] = sortedClusters[i];

    const color = SEED_COLORS[i % SEED_COLORS.length];
    const label = labelFromClusterTitles(
      papers.map(p => p.title ?? "")
    );

    for (const p of papers) {
      if (seedSet.has(p.id)) {
        colorBySeed.set(p.id, color);
        clusterIdxBySeed.set(p.id, i);
      } else {
        colorByChild.set(p.id, color);
        clusterIdxByChild.set(p.id, i);
      }
    }

    subtopics.push({
      color,
      label,
      seedIds: papers.filter(p => seedSet.has(p.id)).map(p => p.id),
    });
  }

  for (const s of seeds) {
    if (!colorBySeed.has(s.id)) {
      colorBySeed.set(s.id, ORPHAN_COLOR);
      clusterIdxBySeed.set(s.id, Number.MAX_SAFE_INTEGER);
    }
  }

  for (const c of citations) {
    if (!colorByChild.has(c.id)) {
      colorByChild.set(c.id, ORPHAN_COLOR);
      clusterIdxByChild.set(c.id, Number.MAX_SAFE_INTEGER);
    }
  }

  return {
    colorBySeed,
    colorByChild,
    clusterIdxBySeed,
    clusterIdxByChild,
    subtopics,
  };
}