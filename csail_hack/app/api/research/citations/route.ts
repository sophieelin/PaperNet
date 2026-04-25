import { NextResponse } from "next/server";
import { buildCitationGraph } from "@/lib/graph";
import type { ResearchPaper } from "@/lib/papers";
import { fetchTopCitationsForSeeds } from "@/lib/semanticScholar";
import { readRunData, writeRunData } from "@/lib/storage";

export async function POST(request: Request) {
  try {
    const { runId } = (await request.json()) as { runId?: string };
    if (!runId) return NextResponse.json({ error: "runId is required" }, { status: 400 });

    const seeds = await readRunData<ResearchPaper[]>(runId, "seeds.json");
    const { selections, dedupedChildren } = await fetchTopCitationsForSeeds(seeds, 3);
    const graph = buildCitationGraph(seeds, selections, dedupedChildren);

    await writeRunData(runId, "citations.json", selections);
    await writeRunData(runId, "citation-nodes.json", dedupedChildren);
    await writeRunData(runId, "graph.json", graph);

    return NextResponse.json({ runId, selections, children: dedupedChildren, graph });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "citation generation failed" },
      { status: 500 },
    );
  }
}

