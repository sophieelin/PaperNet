import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import type { AnyNodeData } from "@/lib/papers";
import type { Edge, Node } from "@xyflow/react";

type StoredGraph = {
  nodes: Node<AnyNodeData>[];
  edges: Edge[];
};

const dataRoot = path.join(process.cwd(), "data");

export async function GET(request: Request) {
  const url = new URL(request.url);
  const runId = url.searchParams.get("runId")?.trim();

  if (runId) {
    try {
      const runDir = path.join(dataRoot, runId);
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
    const entries = await readdir(dataRoot, { withFileTypes: true });
    const runs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a));
    return NextResponse.json({ runs });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "failed to list runs" },
      { status: 500 },
    );
  }
}

