import { NextResponse } from "next/server";
import { buildCitationGraph } from "@/lib/graph";
import { clusterPapersWithOpenAI } from "@/lib/openaiClustering";
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

    // Try the LLM-driven clusterer first when an API key is configured.
    // It produces sharper topic labels and forces every paper into
    // exactly one topic. If it fails for any reason (missing key,
    // network, malformed response) we fall through to the heuristic
    // clusterer baked into buildCitationGraph.
    const llmClusters = await clusterPapersWithOpenAI(
      meta.query ?? "",
      seeds,
      dedupedChildren,
    );
    if (llmClusters) {
      console.log(
        "[citations] using OpenAI clustering:",
        llmClusters.subtopics.length,
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
      llmClusters ?? undefined,
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
