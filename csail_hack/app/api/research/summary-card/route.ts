import { NextResponse } from "next/server";
import { buildSummaryCard } from "@/lib/agents";
import type { GraphNodeData } from "@/lib/papers";
import { readRunData, writeRunData } from "@/lib/storage";
import type { Node } from "@xyflow/react";

type StoredGraph = {
  nodes: Array<Node<GraphNodeData>>;
};

export async function POST(request: Request) {
  try {
    const { runId, query } = (await request.json()) as { runId?: string; query?: string };
    if (!runId) return NextResponse.json({ error: "runId is required" }, { status: 400 });

    const graph = await readRunData<StoredGraph>(runId, "graph.json");
    const papers = [...new Map(graph.nodes.map((node) => [node.data.paper.id, node.data.paper])).values()];

    const cards = await Promise.all(
      papers.map(async (paper) => ({
        paperId: paper.id,
        card: await buildSummaryCard({ paper, query, runId }),
      })),
    );

    await writeRunData(runId, "summary-cards.json", cards);
    return NextResponse.json({ runId, processed: cards.length, file: "summary-cards.json" });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "summary-card run failed" },
      { status: 500 },
    );
  }
}

