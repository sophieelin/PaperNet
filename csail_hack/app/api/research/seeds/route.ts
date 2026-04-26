import { NextResponse } from "next/server";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { buildSeedGraph } from "@/lib/graph";
import type { ResearchPaper } from "@/lib/papers";
import { searchSupportedPapers } from "@/lib/semanticScholar";
import { createRunId, writeRunData } from "@/lib/storage";

const safeSlug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 64);

const dataRoot = () => path.join(process.cwd(), "data");

async function readLatestSeedCache(query: string): Promise<ResearchPaper[] | undefined> {
  const slug = safeSlug(query);
  if (!slug) return undefined;
  const entries = await readdir(dataRoot(), { withFileTypes: true }).catch(() => []);
  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${slug}-`))
      .map(async (entry) => {
        const runDir = path.join(dataRoot(), entry.name);
        const s = await stat(runDir);
        return { runDir, mtimeMs: s.mtimeMs };
      }),
  );
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const candidate of candidates) {
    const raw = await readFile(path.join(candidate.runDir, "seeds.json"), "utf8").catch(() => "");
    if (!raw) continue;
    const seeds = JSON.parse(raw) as ResearchPaper[];
    if (Array.isArray(seeds) && seeds.length > 0) return seeds;
  }
}

export async function POST(request: Request) {
  try {
    const { query } = (await request.json()) as { query?: string };
    const normalized = query?.trim();
    if (!normalized) return NextResponse.json({ error: "query is required" }, { status: 400 });

    const seeds = (await readLatestSeedCache(normalized)) ?? (await searchSupportedPapers(normalized, 20));
    const graph = buildSeedGraph(seeds);
    const runId = createRunId(normalized);

    await writeRunData(runId, "query.json", { query: normalized, createdAt: new Date().toISOString() });
    await writeRunData(runId, "seeds.json", seeds);
    await writeRunData(runId, "seed-graph.json", graph);

    return NextResponse.json({ runId, query: normalized, seeds, graph });
  } catch (error) {
    // Surface the full error in the dev terminal — without this the route
    // returns a 500 with no clue what actually broke.
    console.error("[seeds] failed:", error);
    const message = error instanceof Error ? error.message : "seed generation failed";
    return NextResponse.json(
      { error: message },
      { status: message.includes("rate limit") ? 429 : 500 },
    );
  }
}
