"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Controls, ReactFlow } from "@xyflow/react";
import type { Edge, Node } from "@xyflow/react";
import type { ReactFlowInstance } from "@xyflow/react";
import type { GraphNodeData } from "@/lib/papers";
import "@xyflow/react/dist/style.css";

type GraphPayload = { nodes: Node<GraphNodeData>[]; edges: Edge[] };

export default function Home() {
  const [query, setQuery] = useState("");
  const [runId, setRunId] = useState("");
  const [graph, setGraph] = useState<GraphPayload>({ nodes: [], edges: [] });
  const [phase, setPhase] = useState<"idle" | "seeds" | "citations">("idle");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance | null>(null);

  const subtitle = useMemo(() => {
    if (!runId) return "Search recent papers to generate a map-like graph.";
    if (phase === "seeds") return `Seed graph ready (${graph.nodes.length} nodes).`;
    return `Citation graph ready (${graph.nodes.length} nodes, ${graph.edges.length} edges).`;
  }, [graph.edges.length, graph.nodes.length, phase, runId]);

  useEffect(() => {
    if (!flowInstance || graph.nodes.length === 0) return;
    flowInstance.fitView({ padding: 0.2, duration: 450 });
  }, [flowInstance, graph.edges.length, graph.nodes.length]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextQuery = query.trim();
    if (!nextQuery || loading) return;
    setLoading(true);
    setError("");
    try {
      setPhase("idle");
      const seedsRes = await fetch("/api/research/seeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: nextQuery }),
      });
      const seedsData = (await seedsRes.json()) as {
        error?: string;
        runId: string;
        graph: GraphPayload;
      };
      if (!seedsRes.ok) throw new Error(seedsData.error ?? "Failed to generate seeds");
      setRunId(seedsData.runId);
      setGraph(seedsData.graph);
      setPhase("seeds");

      const citationsRes = await fetch("/api/research/citations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: seedsData.runId }),
      });
      const citationsData = (await citationsRes.json()) as { error?: string; graph: GraphPayload };
      if (!citationsRes.ok) throw new Error(citationsData.error ?? "Failed to generate citations");
      setGraph(citationsData.graph);
      setPhase("citations");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-slate-100">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(148,163,184,0.22),transparent_45%),radial-gradient(circle_at_80%_70%,rgba(51,65,85,0.16),transparent_45%),repeating-linear-gradient(0deg,rgba(100,116,139,0.08)_0,rgba(100,116,139,0.08)_1px,transparent_1px,transparent_22px),repeating-linear-gradient(90deg,rgba(100,116,139,0.08)_0,rgba(100,116,139,0.08)_1px,transparent_1px,transparent_22px)]" />
      <ReactFlow
        nodes={graph.nodes}
        edges={graph.edges}
        fitView
        onInit={setFlowInstance}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        minZoom={0.3}
        maxZoom={1.4}
      >
        <Controls showInteractive={false} />
      </ReactFlow>

      <section className="pointer-events-none absolute inset-x-0 bottom-0 p-6">
        <form
          onSubmit={onSubmit}
          className="pointer-events-auto mx-auto flex w-full max-w-3xl items-center gap-3 rounded-2xl border border-slate-300/70 bg-white/88 p-3 shadow-xl backdrop-blur"
        >
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Describe a research topic..."
            className="h-12 flex-1 rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none ring-slate-900/20 focus:ring"
          />
          <button
            type="submit"
            disabled={loading}
            className="h-12 rounded-xl bg-slate-900 px-5 text-sm font-medium text-white disabled:opacity-60"
          >
            {loading ? "Building..." : "Map"}
          </button>
        </form>

        <div className="pointer-events-none mx-auto mt-2 max-w-3xl px-1 text-xs text-slate-700">
          {error ? <span className="text-red-600">{error}</span> : subtitle}
        </div>
      </section>
    </main>
  );
}
