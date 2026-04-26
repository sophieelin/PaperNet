import { ORPHAN_COLOR, SEED_COLORS, type ClusterInfo } from "@/lib/graph";
import type { ResearchPaper, Subtopic } from "@/lib/papers";

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "of", "for", "with", "in", "on", "to", "from",
  "by", "using", "via", "toward", "towards", "approach", "method", "methods",
  "based", "study", "analysis", "system", "systems", "model", "models", "paper",
]);

type Vector = number[];

export function floorPapersDividedByTen(totalPapers: number): number {
  return Math.floor(totalPapers / 10);
}

function computeClusterCount(totalPapers: number): number {
  // Requirement: divide paper count by 10 and take floor.
  const raw = floorPapersDividedByTen(totalPapers);
  return Math.max(1, Math.min(raw, totalPapers));
}

function tokenizeTitle(title: string): string[] {
  const tokens = title.toLowerCase().match(/[a-z][a-z0-9-]+/g) ?? [];
  return tokens.filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
}

function cosineSimilarity(a: Vector, b: Vector): number {
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    aNorm += a[i] * a[i];
    bNorm += b[i] * b[i];
  }
  if (aNorm === 0 || bNorm === 0) return 0;
  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}

function normalize(v: Vector): Vector {
  let norm = 0;
  for (let i = 0; i < v.length; i += 1) norm += v[i] * v[i];
  if (norm === 0) return v.slice();
  const denom = Math.sqrt(norm);
  return v.map((x) => x / denom);
}

class TitleVectorStore {
  vocabulary: string[];
  vectorsByPaperId: Map<string, Vector>;

  constructor(papers: ResearchPaper[]) {
    const vocabSet = new Set<string>();
    const tokenMap = new Map<string, string[]>();
    for (const paper of papers) {
      const tokens = tokenizeTitle(paper.title ?? "");
      tokenMap.set(paper.id, tokens);
      for (const token of tokens) vocabSet.add(token);
    }
    this.vocabulary = [...vocabSet].sort();
    this.vectorsByPaperId = new Map();
    for (const paper of papers) {
      const tokens = tokenMap.get(paper.id) ?? [];
      const freq = new Map<string, number>();
      for (const token of tokens) freq.set(token, (freq.get(token) ?? 0) + 1);
      const vector = this.vocabulary.map((token) => freq.get(token) ?? 0);
      this.vectorsByPaperId.set(paper.id, normalize(vector));
    }
  }

  getVector(paperId: string): Vector {
    return this.vectorsByPaperId.get(paperId) ?? this.vocabulary.map(() => 0);
  }
}

function kMeansCosine(vectors: Vector[], k: number, maxIterations = 25): number[] {
  if (vectors.length === 0) return [];
  const assignments = new Array<number>(vectors.length).fill(0);
  const centroids: Vector[] = [];

  for (let i = 0; i < k; i += 1) {
    centroids.push(vectors[Math.min(i, vectors.length - 1)].slice());
  }

  for (let iter = 0; iter < maxIterations; iter += 1) {
    let changed = false;

    for (let i = 0; i < vectors.length; i += 1) {
      let bestCluster = 0;
      let bestScore = -Infinity;
      for (let c = 0; c < k; c += 1) {
        const score = cosineSimilarity(vectors[i], centroids[c]);
        if (score > bestScore) {
          bestScore = score;
          bestCluster = c;
        }
      }
      if (assignments[i] !== bestCluster) {
        assignments[i] = bestCluster;
        changed = true;
      }
    }

    const sums: Vector[] = centroids.map((c) => c.map(() => 0));
    const counts = new Array<number>(k).fill(0);
    for (let i = 0; i < vectors.length; i += 1) {
      const cluster = assignments[i];
      counts[cluster] += 1;
      for (let d = 0; d < vectors[i].length; d += 1) sums[cluster][d] += vectors[i][d];
    }
    for (let c = 0; c < k; c += 1) {
      if (counts[c] === 0) continue;
      centroids[c] = normalize(sums[c].map((value) => value / counts[c]));
    }

    if (!changed) break;
  }

  return assignments;
}

function labelFromClusterTitles(titles: string[]): string {
  const counts = new Map<string, number>();
  for (const title of titles) {
    const uniqueTokens = new Set(tokenizeTitle(title));
    for (const token of uniqueTokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t);
  if (top.length === 0) return "Related Work";
  return top.map((w) => (w.length > 2 ? `${w[0].toUpperCase()}${w.slice(1)}` : w)).join(" ");
}

export async function clusterPapersWithTitleVectors(
  _query: string,
  seeds: ResearchPaper[],
  citations: ResearchPaper[],
): Promise<ClusterInfo | null> {
  const allPapers = [...seeds, ...citations];
  if (allPapers.length === 0) return null;

  const rawK = computeClusterCount(allPapers.length);
  const k = Math.min(rawK, seeds.length || 1);
  const vectorStore = new TitleVectorStore(allPapers);
  const vectors = allPapers.map((paper) => vectorStore.getVector(paper.id));
  const assignments = kMeansCosine(vectors, k);

  const buckets = new Map<number, ResearchPaper[]>();
  for (let i = 0; i < allPapers.length; i += 1) {
    const idx = assignments[i] ?? 0;
    const list = buckets.get(idx) ?? [];
    list.push(allPapers[i]);
    buckets.set(idx, list);
  }

  const sortedClusters = [...buckets.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  );
  const oldToNew = new Map<number, number>();
  sortedClusters.forEach(([old], next) => oldToNew.set(old, next));

  const seedIdSet = new Set(seeds.map((s) => s.id));
  const colorBySeed = new Map<string, string>();
  const colorByChild = new Map<string, string>();
  const clusterIdxBySeed = new Map<string, number>();
  const clusterIdxByChild = new Map<string, number>();
  const subtopics: Subtopic[] = [];

  for (const [oldIdx, papers] of sortedClusters) {
    const clusterIdx = oldToNew.get(oldIdx) ?? 0;
    const color = SEED_COLORS[clusterIdx % SEED_COLORS.length];
    const clusterSeeds = papers.filter((paper) => seedIdSet.has(paper.id));
    const label = labelFromClusterTitles(papers.map((paper) => paper.title ?? ""));

    for (const paper of papers) {
      if (seedIdSet.has(paper.id)) {
        colorBySeed.set(paper.id, color);
        clusterIdxBySeed.set(paper.id, clusterIdx);
      } else {
        colorByChild.set(paper.id, color);
        clusterIdxByChild.set(paper.id, clusterIdx);
      }
    }

    subtopics.push({
      color,
      label,
      seedIds: clusterSeeds.map((paper) => paper.id),
    });
  }

  for (const seed of seeds) {
    if (!colorBySeed.has(seed.id)) {
      colorBySeed.set(seed.id, ORPHAN_COLOR);
      clusterIdxBySeed.set(seed.id, Number.MAX_SAFE_INTEGER);
    }
  }
  for (const citation of citations) {
    if (!colorByChild.has(citation.id)) {
      colorByChild.set(citation.id, ORPHAN_COLOR);
      clusterIdxByChild.set(citation.id, Number.MAX_SAFE_INTEGER);
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
