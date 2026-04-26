import { ORPHAN_COLOR, SEED_COLORS, type ClusterInfo } from "@/lib/graph";
import type { ResearchPaper, Subtopic } from "@/lib/papers";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

type Vector = number[];

/**
 * --- clustering config ---
 */
export function floorPapersDividedByTen(totalPapers: number): number {
  return Math.floor(totalPapers / 10);
}

function computeClusterCount(totalPapers: number): number {
  const raw = floorPapersDividedByTen(totalPapers);
  return Math.max(1, Math.min(raw, totalPapers));
}

/**
 * --- embeddings  ---
 */
async function embedPapers(papers: ResearchPaper[]): Promise<Vector[]> {
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: papers.map(p => p.title ?? ""),
  });

  return res.data.map(d => d.embedding);
}

/**
 * --- cosine K-means ---
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

function kMeansCosine(vectors: Vector[], k: number, maxIterations = 25): number[] {
  if (vectors.length === 0) return [];

  const assignments = new Array(vectors.length).fill(0);

  const centroids = Array.from({ length: k }, () =>
    vectors[Math.floor(Math.random() * vectors.length)].slice()
  );

  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;

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
      const norm = Math.sqrt(mean.reduce((s, v) => s + v * v, 0)) || 1;

      centroids[c] = mean.map(v => v / norm);
    }

    if (!changed) break;
  }

  return assignments;
}

/**
 * OpenAI cluster labeling
 */
async function labelClusterWithOpenAI(titles: string[]): Promise<string> {
  const prompt = `
You are labeling a research paper cluster.

Given these paper titles, generate a short 2–5 word topic label.
Be specific and technical (not generic like "Research").

Titles:
${titles.map(t => `- ${t}`).join("\n")}

Return ONLY the label.
`;

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
  });

  return res.choices[0]?.message?.content?.trim() || "Related Work";
}

/**
 * --- MAIN FUNCTION ---
 */
export async function clusterPapersWithTitleVectors(
  _query: string,
  seeds: ResearchPaper[],
  citations: ResearchPaper[],
): Promise<ClusterInfo | null> {

  const allPapers = [...seeds, ...citations];
  if (!allPapers.length) return null;

  const k = computeClusterCount(allPapers.length);

  const vectors = await embedPapers(allPapers);
  const assignments = kMeansCosine(vectors, k);

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

  /**
   * batch label the clusters with OpenAI
   */
  const clusterLabels = await Promise.all(
    sortedClusters.map(([_, papers]) =>
      labelClusterWithOpenAI(papers.map(p => p.title ?? ""))
    )
  );

  for (let i = 0; i < sortedClusters.length; i++) {
    const [oldIdx, papers] = sortedClusters[i];
    const clusterIdx = i;
    const color = SEED_COLORS[clusterIdx % SEED_COLORS.length];
    const label = clusterLabels[i];

    for (const p of papers) {
      if (seedSet.has(p.id)) {
        colorBySeed.set(p.id, color);
        clusterIdxBySeed.set(p.id, clusterIdx);
      } else {
        colorByChild.set(p.id, color);
        clusterIdxByChild.set(p.id, clusterIdx);
      }
    }

    subtopics.push({
      color,
      label,
      seedIds: papers.filter(p => seedSet.has(p.id)).map(p => p.id),
    });
  }

  for (const seed of seeds) {
    if (!colorBySeed.has(seed.id)) {
      colorBySeed.set(seed.id, ORPHAN_COLOR);
      clusterIdxBySeed.set(seed.id, Number.MAX_SAFE_INTEGER);
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