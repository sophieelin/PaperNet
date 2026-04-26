import { ORPHAN_COLOR, SEED_COLORS, type ClusterInfo } from "@/lib/graph";
import type { ResearchPaper, Subtopic } from "@/lib/papers";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

type Vector = number[];

/**
 * --- embeddings ---
 */
async function embedPapers(papers: ResearchPaper[]): Promise<Vector[]> {
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: papers.map(p => p.title ?? ""),
  });

  return res.data.map(d => d.embedding);
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

function cosineDistance(a: Vector, b: Vector): number {
  return 1 - cosineSimilarity(a, b);
}

/**
 * --- DBSCAN ---
 * returns cluster assignments per point
 * -1 = noise
 */
function dbscan(vectors: Vector[], eps = 0.25, minPts = 3): number[] {
  const labels = new Array(vectors.length).fill(-1);
  const visited = new Array(vectors.length).fill(false);

  let clusterId = 0;

  function regionQuery(i: number): number[] {
    const neighbors: number[] = [];

    for (let j = 0; j < vectors.length; j++) {
      if (cosineDistance(vectors[i], vectors[j]) <= eps) {
        neighbors.push(j);
      }
    }

    return neighbors;
  }

  function expandCluster(i: number, neighbors: number[], clusterId: number) {
    labels[i] = clusterId;

    const queue = [...neighbors];

    while (queue.length > 0) {
      const j = queue.pop()!;

      if (!visited[j]) {
        visited[j] = true;

        const jNeighbors = regionQuery(j);
        if (jNeighbors.length >= minPts) {
          queue.push(...jNeighbors);
        }
      }

      if (labels[j] === -1) {
        labels[j] = clusterId;
      }
    }
  }

  for (let i = 0; i < vectors.length; i++) {
    if (visited[i]) continue;

    visited[i] = true;

    const neighbors = regionQuery(i);

    if (neighbors.length < minPts) {
      labels[i] = -1; // noise
    } else {
      expandCluster(i, neighbors, clusterId);
      clusterId++;
    }
  }

  return labels;
}

/**
 * --- OpenAI cluster labeling ---
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

  const vectors = await embedPapers(allPapers);

  /**
   * DBSCAN clustering (no k needed)
   */
  const assignments = dbscan(vectors, 0.08, 8);

  const buckets = new Map<number, ResearchPaper[]>();

  for (let i = 0; i < allPapers.length; i++) {
    const c = assignments[i];

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
   * batch label clusters
   */
  const clusterLabels = await Promise.all(
    sortedClusters.map(([_, papers]) =>
      labelClusterWithOpenAI(papers.map(p => p.title ?? ""))
    )
  );

  for (let i = 0; i < sortedClusters.length; i++) {
    const [oldIdx, papers] = sortedClusters[i];
    const clusterIdx = i;

    const color =
      oldIdx === -1
        ? ORPHAN_COLOR
        : SEED_COLORS[clusterIdx % SEED_COLORS.length];

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

  /**
   * handle unassigned seeds
   */
  for (const seed of seeds) {
    if (!colorBySeed.has(seed.id)) {
      colorBySeed.set(seed.id, ORPHAN_COLOR);
      clusterIdxBySeed.set(seed.id, Number.MAX_SAFE_INTEGER);
    }
  }

  /**
   * handle unassigned citations
   */
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