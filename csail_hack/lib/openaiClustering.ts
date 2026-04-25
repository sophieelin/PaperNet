import { ORPHAN_COLOR, SEED_COLORS, type ClusterInfo } from "@/lib/graph";
import type { ResearchPaper, Subtopic } from "@/lib/papers";

// Why this module exists:
//   The heuristic clusterer in lib/graph.ts groups *seeds* using
//   bibliographic coupling + shared title phrases, and then assigns
//   citations to whichever cluster owns most of their parents. That works
//   but produces topic labels that are sometimes weak ("Generative
//   Models", "Diffusion Approaches") and can leave many seeds as
//   orphans.
//
//   This module asks OpenAI to do the same job using actual paper
//   semantics (titles + abstracts), forcing every paper — seeds AND
//   citations — into exactly one well-named subtopic. The result is
//   returned in the *same* ClusterInfo shape so it slots into
//   buildCitationGraph without further changes.

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";

const truncate = (input: string, max: number): string => {
  const flat = input.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, Math.max(0, max - 1))}…`;
};

type RawSubtopic = { label?: unknown; paperIds?: unknown };

const sanitizeLabel = (raw: unknown): string => {
  if (typeof raw !== "string") return "Untitled topic";
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) return "Untitled topic";
  // Cap label length so it doesn't blow up the legend.
  return trimmed.length > 60 ? `${trimmed.slice(0, 59)}…` : trimmed;
};

const sanitizeIds = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const value of raw) {
    if (typeof value === "string" && value.length > 0) out.push(value);
  }
  return out;
};

const buildPrompt = (query: string, papers: ResearchPaper[]): string => {
  const lines = papers.map((paper, idx) => {
    const pid = `p${idx}`;
    const title = truncate(paper.title || "(untitled)", 220);
    const summary = paper.summary ? ` | ${truncate(paper.summary, 260)}` : "";
    const meta = paper.year ? ` | ${paper.year}` : "";
    return `- ${pid}${meta} | ${title}${summary}`;
  });

  return [
    `User query: "${query}"`,
    "",
    "Papers (the ids on the left are the only labels you may use):",
    ...lines,
    "",
    "Cluster the papers into 3–7 distinct subtopics that meaningfully",
    "organise them in the context of the query. Constraints:",
    "1. Every paper id MUST appear in exactly one subtopic. No omissions, no duplicates.",
    "2. Each subtopic label is 2–5 words, descriptive, and NOT a paraphrase of the query.",
    "3. Avoid generic labels like 'Other Methods' or 'Misc'.",
    "4. Prefer 4–6 clusters when there are 15+ papers.",
    "",
    "Respond with ONLY this JSON object, no commentary:",
    '{ "subtopics": [{ "label": "...", "paperIds": ["p0", "p2", ...] }, ...] }',
  ].join("\n");
};

// Ensure every paper ends up in exactly one cluster, repairing missing or
// duplicated assignments from the model.
const repairAssignments = (
  papers: ResearchPaper[],
  rawSubtopics: RawSubtopic[],
): { label: string; paperIds: string[] }[] => {
  const cleaned: { label: string; paperIds: string[] }[] = rawSubtopics
    .map((entry) => ({
      label: sanitizeLabel(entry.label),
      paperIds: sanitizeIds(entry.paperIds),
    }))
    .filter((entry) => entry.paperIds.length > 0);

  if (cleaned.length === 0) return [];

  const validIds = new Set(papers.map((_, idx) => `p${idx}`));
  const seen = new Set<string>();
  for (const cluster of cleaned) {
    cluster.paperIds = cluster.paperIds.filter((pid) => {
      if (!validIds.has(pid)) return false;
      if (seen.has(pid)) return false;
      seen.add(pid);
      return true;
    });
  }

  // Drop clusters that ended up empty after dedup.
  const nonEmpty = cleaned.filter((c) => c.paperIds.length > 0);
  if (nonEmpty.length === 0) return [];

  // Any paper the model forgot goes into the smallest existing cluster
  // (so we don't create a synthetic "leftovers" topic when the user
  // explicitly wants every paper to fit somewhere).
  const missing = [...validIds].filter((pid) => !seen.has(pid));
  if (missing.length > 0) {
    nonEmpty.sort((a, b) => a.paperIds.length - b.paperIds.length);
    nonEmpty[0].paperIds.push(...missing);
  }

  return nonEmpty;
};

type OpenAIChatResponse = {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
};

// Call OpenAI to cluster the given papers. Returns null when the API
// key is missing or the request fails — callers fall back to the
// heuristic clusterer.
export async function clusterPapersWithOpenAI(
  query: string,
  seeds: ResearchPaper[],
  citations: ResearchPaper[],
): Promise<ClusterInfo | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const allPapers = [...seeds, ...citations];
  if (allPapers.length === 0) return null;

  const prompt = buildPrompt(query, allPapers);
  const model = process.env.OPENAI_CLUSTER_MODEL || DEFAULT_MODEL;

  let response: Response;
  try {
    response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "You are an expert research librarian. You cluster academic papers into coherent subtopics and return strict JSON only.",
          },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
    });
  } catch (err) {
    console.error("[openai cluster] network error:", err);
    return null;
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "<no body>");
    console.error(
      "[openai cluster] HTTP",
      response.status,
      response.statusText,
      detail,
    );
    return null;
  }

  let payload: OpenAIChatResponse;
  try {
    payload = (await response.json()) as OpenAIChatResponse;
  } catch (err) {
    console.error("[openai cluster] JSON read failed:", err);
    return null;
  }

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    console.error("[openai cluster] empty response", payload);
    return null;
  }

  let parsed: { subtopics?: RawSubtopic[] };
  try {
    parsed = JSON.parse(content) as { subtopics?: RawSubtopic[] };
  } catch (err) {
    console.error("[openai cluster] could not parse JSON:", err, content);
    return null;
  }

  const repaired = repairAssignments(allPapers, parsed.subtopics ?? []);
  if (repaired.length === 0) {
    console.error("[openai cluster] no usable clusters in response", parsed);
    return null;
  }

  // Sort clusters largest-first so the most "central" topic gets the
  // first (most saturated) palette colour.
  repaired.sort((a, b) => b.paperIds.length - a.paperIds.length);

  const seedIds = new Set(seeds.map((s) => s.id));
  const colorBySeed = new Map<string, string>();
  const colorByChild = new Map<string, string>();
  const clusterIdxBySeed = new Map<string, number>();
  const clusterIdxByChild = new Map<string, number>();
  const subtopics: Subtopic[] = [];

  repaired.forEach((cluster, clusterIdx) => {
    const color = SEED_COLORS[clusterIdx % SEED_COLORS.length];
    const memberSeedIds: string[] = [];
    for (const pid of cluster.paperIds) {
      const numeric = Number(pid.slice(1));
      if (!Number.isFinite(numeric)) continue;
      const paper = allPapers[numeric];
      if (!paper) continue;
      if (seedIds.has(paper.id)) {
        colorBySeed.set(paper.id, color);
        clusterIdxBySeed.set(paper.id, clusterIdx);
        memberSeedIds.push(paper.id);
      } else {
        colorByChild.set(paper.id, color);
        clusterIdxByChild.set(paper.id, clusterIdx);
      }
    }
    subtopics.push({ color, label: cluster.label, seedIds: memberSeedIds });
  });

  // Defensive: any paper that somehow didn't end up in a cluster falls
  // back to the orphan colour so the graph still renders.
  for (const seed of seeds) {
    if (!colorBySeed.has(seed.id)) {
      colorBySeed.set(seed.id, ORPHAN_COLOR);
      clusterIdxBySeed.set(seed.id, Number.MAX_SAFE_INTEGER);
    }
  }
  for (const child of citations) {
    if (!colorByChild.has(child.id)) {
      colorByChild.set(child.id, ORPHAN_COLOR);
      clusterIdxByChild.set(child.id, Number.MAX_SAFE_INTEGER);
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
