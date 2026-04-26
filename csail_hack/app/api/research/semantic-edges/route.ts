import { NextResponse } from "next/server";
import type { Edge } from "@xyflow/react";
import { readRunData, writeRunData } from "@/lib/storage";

type SummaryCardFile = Array<{
  paperId: string;
  card?: { summary?: { paragraph?: string } };
}>;

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

async function generateSemanticEdgesFromCards(cards: SummaryCardFile) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY in environment.");

  const items = cards
    .map((c) => ({
      paperId: c.paperId,
      paragraph: c.card?.summary?.paragraph?.trim() ?? "",
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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const runId = url.searchParams.get("runId")?.trim();
  if (!runId) return NextResponse.json({ error: "runId is required" }, { status: 400 });
  try {
    const edges = await readRunData<Edge[]>(runId, "semantic-edges.json");
    return NextResponse.json({ runId, edges, count: edges.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "semantic-edges not found";
    if (message.includes("ENOENT") || message.includes("File not found")) {
      return NextResponse.json({ runId, edges: [], count: 0 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { runId } = (await request.json()) as { runId?: string };
    if (!runId) return NextResponse.json({ error: "runId is required" }, { status: 400 });
    const cards = await readRunData<SummaryCardFile>(runId, "summary-cards.json");
    if (cards.length === 0) {
      return NextResponse.json(
        { error: "summary-cards.json is empty; run Summary Card first." },
        { status: 400 },
      );
    }
    const edges = await generateSemanticEdgesFromCards(cards);
    await writeRunData(runId, "semantic-edges.json", edges);
    return NextResponse.json({ runId, edges, count: edges.length });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to generate semantic edges";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

