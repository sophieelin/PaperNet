import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { findRunDirectoryWithGraph, listAllRunIdsWithGraph } from "@/lib/storage";
import type { AnyNodeData } from "@/lib/papers";
import type { Edge, Node } from "@xyflow/react";

type StoredGraph = {
  nodes: Node<AnyNodeData>[];
  edges: Edge[];
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const runId = url.searchParams.get("runId")?.trim();

  if (runId) {
    const runDir = findRunDirectoryWithGraph(runId);
    if (!runDir) {
      return NextResponse.json(
        { error: "Run not found (no graph.json under any data path)" },
        { status: 404 },
      );
    }
    try {
      const graph = JSON.parse(
        await readFile(path.join(runDir, "graph.json"), "utf8"),
      ) as StoredGraph;
      const query = JSON.parse(
        await readFile(path.join(runDir, "query.json"), "utf8"),
      ) as { query?: string };
      return NextResponse.json({ runId, query: query.query ?? "", graph });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "run not found" },
        { status: 404 },
      );
    }
  }

  try {
    const runs = listAllRunIdsWithGraph();
    return NextResponse.json({ runs });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "failed to list runs" },
      { status: 500 },
    );
  }
}

