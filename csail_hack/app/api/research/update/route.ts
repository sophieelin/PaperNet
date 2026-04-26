import { NextResponse } from "next/server";
import type { Edge, Node } from "@xyflow/react";
import { buildSummaryCard } from "@/lib/agents";
import { searchRecentArxivPapers } from "@/lib/arxiv";
import { buildCitationGraph } from "@/lib/graph";
import { clusterPapersWithOpenAI } from "@/lib/openaiClustering";
import type { GraphNodeData, ResearchPaper } from "@/lib/papers";
import { fetchTopCitationsForSeeds } from "@/lib/semanticScholar";
import { readRunData, writeRunData } from "@/lib/storage";

const UPDATE_INTERVAL_MS = 12 * 60 * 60 * 1000;

type QueryMeta = {
  query?: string;
  createdAt?: string;
  lastUpdatedAt?: string;
};

type SummaryCardFile = Array<{
  paperId: string;
  card: Awaited<ReturnType<typeof buildSummaryCard>>;
}>;

type StoredGraph = { nodes: Array<Node<GraphNodeData>> };

type SemanticEdgeRecord = {
  sourceId: string;
  targetId: string;
  relationType: "Builds On" | "Similar Approach" | "Contrasting Approach";
  reason?: string;
};

const EDGE_STYLES: Record<SemanticEdgeRecord["relationType"], { stroke: string; dash?: string }> = {
  "Builds On": { stroke: "#22c55e" },
  "Similar Approach": { stroke: "#60a5fa", dash: "4 2" },
  "Contrasting Approach": { stroke: "#f97316", dash: "2 2" },
};

function hasPaperId(paper: unknown): paper is GraphNodeData["paper"] & { id: string } {
  return (
    typeof paper === "object" &&
    paper !== null &&
    "id" in paper &&
    typeof (paper as { id?: unknown }).id === "string" &&
    (paper as { id: string }).id.trim().length > 0
  );
}

async function generateSemanticEdges(cards: SummaryCardFile) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY in environment.");
  const items = cards
    .map((c) => ({ paperId: c.paperId, paragraph: c.card.summary?.paragraph?.trim() ?? "" }))
    .filter((x) => x.paragraph);
  if (items.length < 2) return [] as Edge[];

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-5-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You infer high-quality semantic relationships between paper summaries. Return only JSON.",
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
  if (!response.ok) throw new Error(`OpenAI edge generation failed (${response.status})`);
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const cleaned = (data.choices?.[0]?.message?.content ?? "{}")
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

export async function POST(request: Request) {
  try {
    const { runId, force } = (await request.json()) as { runId?: string; force?: boolean };
    if (!runId) return NextResponse.json({ error: "runId is required" }, { status: 400 });

    const now = Date.now();
    const meta = await readRunData<QueryMeta>(runId, "query.json");
    const query = meta.query?.trim();
    if (!query) return NextResponse.json({ error: "query missing for run" }, { status: 400 });

    const last = meta.lastUpdatedAt ? Date.parse(meta.lastUpdatedAt) : NaN;
    const elapsedMs = Number.isFinite(last) ? now - last : Number.POSITIVE_INFINITY;
    if (!force && elapsedMs < UPDATE_INTERVAL_MS) {
      return NextResponse.json({
        runId,
        skipped: true,
        reason: "interval_not_reached",
        nextUpdateInMs: UPDATE_INTERVAL_MS - elapsedMs,
      });
    }

    const currentSeeds = await readRunData<ResearchPaper[]>(runId, "seeds.json").catch(() => []);
    const latestSeeds = await searchRecentArxivPapers(query, 20, 365);
    const existingIds = new Set(currentSeeds.map((s) => s.id));
    const newSeeds = latestSeeds.filter((s) => !existingIds.has(s.id));
    if (newSeeds.length === 0) {
      await writeRunData(runId, "query.json", {
        ...meta,
        query,
        lastUpdatedAt: new Date(now).toISOString(),
      });
      return NextResponse.json({ runId, skipped: true, reason: "no_new_seeds", newSeedCount: 0 });
    }

    const mergedSeeds = [...newSeeds, ...currentSeeds];
    const { selections, dedupedChildren } = await fetchTopCitationsForSeeds(mergedSeeds, 5);
    const llmClusters = await clusterPapersWithOpenAI(query, mergedSeeds, dedupedChildren);
    const graph = buildCitationGraph(
      mergedSeeds,
      selections,
      dedupedChildren,
      query,
      llmClusters ?? undefined,
    );

    await writeRunData(runId, "seeds.json", mergedSeeds);
    await writeRunData(runId, "citations.json", selections);
    await writeRunData(runId, "citation-nodes.json", dedupedChildren);
    await writeRunData(runId, "graph.json", graph);

    const storedGraph = await readRunData<StoredGraph>(runId, "graph.json");
    const byId = new Map<string, GraphNodeData["paper"]>();
    for (const node of storedGraph.nodes) {
      const paper = node?.data?.paper;
      if (!hasPaperId(paper)) continue;
      byId.set(paper.id, paper);
    }
    const cards = await Promise.all(
      [...byId.values()].map(async (paper) => ({
        paperId: paper.id,
        card: await buildSummaryCard({ paper, query, runId }),
      })),
    );
    await writeRunData(runId, "summary-cards.json", cards);

    let semanticEdgeCount = 0;
    try {
      const semanticEdges = await generateSemanticEdges(cards);
      semanticEdgeCount = semanticEdges.length;
      await writeRunData(runId, "semantic-edges.json", semanticEdges);
    } catch {
      semanticEdgeCount = 0;
    }

    await writeRunData(runId, "query.json", {
      ...meta,
      query,
      lastUpdatedAt: new Date(now).toISOString(),
    });

    return NextResponse.json({
      runId,
      updated: true,
      query,
      newSeedCount: newSeeds.length,
      totalSeedCount: mergedSeeds.length,
      summaryCardCount: cards.length,
      semanticEdgeCount,
      intervalHours: 12,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "update failed" },
      { status: 500 },
    );
  }
}

