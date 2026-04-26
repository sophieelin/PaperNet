import { NextResponse } from "next/server";
import { buildCitationGraph } from "@/lib/graph";
import { clusterPapersWithTitleVectors } from "@/lib/openaiClustering";
import type { ResearchPaper } from "@/lib/papers";
import { fetchTopCitationsForSeeds } from "@/lib/semanticScholar";
import { readRunData, writeRunData } from "@/lib/storage";

export async function POST(request: Request) {
  try {
    const { runId } = (await request.json()) as { runId?: string };
    if (!runId) return NextResponse.json({ error: "runId is required" }, { status: 400 });

    const seeds = await readRunData<ResearchPaper[]>(runId, "seeds.json");
    // The original query is needed by the clusterer to suppress trivial
    // labels like "Diffusion Models" inside a "diffusion models" search.
    const meta = await readRunData<{ query?: string }>(runId, "query.json").catch(
      () => ({} as { query?: string }),
    );
    const { selections, dedupedChildren } = await fetchTopCitationsForSeeds(seeds, 3);

    // Vector-based title clustering (no OpenAI call): build an in-memory
    // vector database from paper titles, then run k-means with cosine
    // similarity where k = floor(totalPapers / 10).
    const vectorClusters = await clusterPapersWithTitleVectors(
      meta.query ?? "",
      seeds,
      dedupedChildren,
    );
    if (vectorClusters) {
      console.log(
        "[citations] using title-vector k-means clustering:",
        vectorClusters.subtopics.length,
        "topics",
      );
    } else {
      console.log("[citations] using heuristic clustering");
    }

    const graph = buildCitationGraph(
      seeds,
      selections,
      dedupedChildren,
      meta.query,
      vectorClusters ?? undefined,
    );

    await writeRunData(runId, "citations.json", selections);
    await writeRunData(runId, "citation-nodes.json", dedupedChildren);
    await writeRunData(runId, "graph.json", graph);

    return NextResponse.json({ runId, selections, children: dedupedChildren, graph });
  } catch (error) {
    console.error("[citations] failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "citation generation failed" },
      { status: 500 },
    );
  }
}
