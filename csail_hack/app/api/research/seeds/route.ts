import { NextResponse } from "next/server";
import { searchRecentArxivPapers } from "@/lib/arxiv";
import { buildSeedGraph } from "@/lib/graph";
import { createRunId, writeRunData } from "@/lib/storage";

export async function POST(request: Request) {
  try {
    const { query } = (await request.json()) as { query?: string };
    const normalized = query?.trim();
    if (!normalized) return NextResponse.json({ error: "query is required" }, { status: 400 });

    const seeds = await searchRecentArxivPapers(normalized, 20, 365);
    const graph = buildSeedGraph(seeds);
    const runId = createRunId(normalized);

    await writeRunData(runId, "query.json", { query: normalized, createdAt: new Date().toISOString() });
    await writeRunData(runId, "seeds.json", seeds);
    await writeRunData(runId, "seed-graph.json", graph);

    return NextResponse.json({ runId, query: normalized, seeds, graph });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "seed generation failed" },
      { status: 500 },
    );
  }
}

