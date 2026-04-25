import { NextResponse } from "next/server";
import { buildSummaryCard } from "@/lib/agents";
import type { GraphNodeData } from "@/lib/papers";
import { readRunData, writeRunData } from "@/lib/storage";
import type { Node } from "@xyflow/react";

type StoredGraph = {
  nodes: Array<Node<GraphNodeData>>;
};

type SummaryCardFile = Array<{
  paperId: string;
  card: Awaited<ReturnType<typeof buildSummaryCard>>;
}>;

function hasPaperId(
  paper: unknown,
): paper is GraphNodeData["paper"] & { id: string } {
  return (
    typeof paper === "object" &&
    paper !== null &&
    "id" in paper &&
    typeof (paper as { id?: unknown }).id === "string" &&
    (paper as { id: string }).id.trim().length > 0
  );
}

export async function POST(request: Request) {
  try {
    const { runId, query } = (await request.json()) as { runId?: string; query?: string };
    if (!runId) return NextResponse.json({ error: "runId is required" }, { status: 400 });

    const graph = await readRunData<StoredGraph>(runId, "graph.json");
    const byId = new Map<string, GraphNodeData["paper"]>();
    for (const node of graph.nodes) {
      const paper = node?.data?.paper;
      if (!hasPaperId(paper)) continue;
      byId.set(paper.id, paper);
    }
    const papers = [...byId.values()];

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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const runId = url.searchParams.get("runId")?.trim();
  if (!runId) return NextResponse.json({ error: "runId is required" }, { status: 400 });
  try {
    const cards = await readRunData<SummaryCardFile>(runId, "summary-cards.json");
    return NextResponse.json({ runId, cards, count: cards.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "summary-cards not found";
    if (message.includes("ENOENT") || message.includes("File not found")) {
      return NextResponse.json({ runId, cards: [], count: 0 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

