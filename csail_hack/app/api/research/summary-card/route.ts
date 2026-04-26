import { NextResponse } from "next/server";
import { buildSummaryCard } from "@/lib/agents";
import type { GraphNodeData } from "@/lib/papers";
import { readRunData, writeRunData } from "@/lib/storage";
import type { Edge, Node } from "@xyflow/react";

type StoredGraph = {
  nodes: Array<Node<GraphNodeData>>;
};

type SummaryCardFile = Array<{
  paperId: string;
  card: Awaited<ReturnType<typeof buildSummaryCard>>;
}>;

type SemanticEdgeRecord = {
  sourceId: string;
  targetId: string;
  relationType: "Builds On" | "Similar Approach" | "Contrasting Approach";
  reason?: string;
};

const SUMMARY_CARD_CONCURRENCY = 3;

const EDGE_STYLES: Record<SemanticEdgeRecord["relationType"], { stroke: string; dash?: string }> = {
  "Builds On": { stroke: "#22c55e" },
  "Similar Approach": { stroke: "#60a5fa", dash: "4 2" },
  "Contrasting Approach": { stroke: "#f97316", dash: "2 2" },
};

async function generateSemanticEdges(cards: SummaryCardFile) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY in environment.");

  const items = cards
    .map((c) => ({
      paperId: c.paperId,
      paragraph: c.card.summary?.paragraph?.trim() ?? "",
    }))
    .filter((x) => x.paragraph);

  if (items.length < 2) return [] as Edge[];

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-5-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You infer high-quality semantic relationships between paper summaries. Return only JSON.",
        },
        {
          role: "user",
          content: [
            "Create semantic graph edges between papers based ONLY on paragraph summaries.",
            "Allowed relationType values: Builds On, Similar Approach, Contrasting Approach.",
            "Return JSON with key edges: array of objects {sourceId,targetId,relationType,reason}.",
            "Rules:",
            "- 0 to 80 edges max.",
            "- No self loops.",
            "- sourceId and targetId must match provided paperIds exactly.",
            "- Keep reason to <= 20 words.",
            "",
            JSON.stringify(items),
          ].join("\n"),
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI edge generation failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content ?? "{}";
  const cleaned = content
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const parsed = JSON.parse(cleaned || "{}") as { edges?: SemanticEdgeRecord[] };
  const validIds = new Set(items.map((i) => i.paperId));
  const dedupe = new Set<string>();

  return (parsed.edges ?? [])
    .filter(
      (e): e is SemanticEdgeRecord =>
        typeof e?.sourceId === "string" &&
        typeof e?.targetId === "string" &&
        e.sourceId !== e.targetId &&
        validIds.has(e.sourceId) &&
        validIds.has(e.targetId) &&
        (e.relationType === "Builds On" ||
          e.relationType === "Similar Approach" ||
          e.relationType === "Contrasting Approach"),
    )
    .filter((e) => {
      const key = `${e.sourceId}|${e.targetId}|${e.relationType}`;
      if (dedupe.has(key)) return false;
      dedupe.add(key);
      return true;
    })
    .slice(0, 80)
    .map((e, idx) => ({
      id: `semantic:${idx + 1}:${e.sourceId}->${e.targetId}`,
      source: e.sourceId,
      target: e.targetId,
      type: "default" as const,
      animated: false,
      style: {
        stroke: EDGE_STYLES[e.relationType].stroke,
        strokeWidth: 1.6,
        opacity: 0.85,
        strokeDasharray: EDGE_STYLES[e.relationType].dash,
      },
      markerEnd: {
        type: "arrowclosed" as const,
        color: EDGE_STYLES[e.relationType].stroke,
        width: 14,
        height: 14,
      },
      data: { relationType: e.relationType, reason: e.reason ?? "" },
    }));
}

const paperPriority = (paper: GraphNodeData["paper"]) => {
  if (paper.source === "arxiv") return 0;
  if (paper.source === "acm") return 1;
  return 2;
};

async function buildCardsInProviderOrder(
  papers: GraphNodeData["paper"][],
  query: string | undefined,
  runId: string,
) {
  const ordered = [...papers].sort(
    (a, b) => paperPriority(a) - paperPriority(b) || a.title.localeCompare(b.title),
  );
  const cards: SummaryCardFile = [];
  for (let index = 0; index < ordered.length; index += SUMMARY_CARD_CONCURRENCY) {
    const batch = ordered.slice(index, index + SUMMARY_CARD_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (paper) => ({
        paperId: paper.id,
        card: await buildSummaryCard({ paper, query, runId }),
      })),
    );
    cards.push(...results);
  }
  return cards;
}

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
    const cards = await buildCardsInProviderOrder(papers, query, runId);

    await writeRunData(runId, "summary-cards.json", cards);
    let semanticEdges: Edge[] = [];
    try {
      semanticEdges = await generateSemanticEdges(cards);
      await writeRunData(runId, "semantic-edges.json", semanticEdges);
    } catch {
      semanticEdges = [];
    }

    return NextResponse.json({
      runId,
      processed: cards.length,
      file: "summary-cards.json",
      semanticEdges: semanticEdges.length,
    });
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
