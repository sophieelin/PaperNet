"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
} from "@xyflow/react";
import type {
  Edge,
  Node,
  NodeProps,
  ReactFlowInstance,
} from "@xyflow/react";
import type { GraphNodeData, ResearchPaper } from "@/lib/papers";
import "@xyflow/react/dist/style.css";

type GraphPayload = { nodes: Node<GraphNodeData>[]; edges: Edge[] };
type Phase = "idle" | "seeds" | "citations";
type PaperNodeType = Node<GraphNodeData, "paper">;

const EXAMPLES = [
  "diffusion models for video",
  "graph neural networks",
  "retrieval augmented generation",
  "mechanistic interpretability",
];

function PaperNode({ data, selected }: NodeProps<PaperNodeType>) {
  const isSeed = data.kind === "seed";
  return (
    <div
      className={[
        "group relative w-[220px] cursor-pointer rounded-xl border px-3 py-2 text-left shadow-sm transition-all",
        isSeed
          ? "border-slate-900 bg-white text-slate-900 shadow-slate-900/10"
          : "border-slate-300 bg-white/95 text-slate-700",
        selected
          ? "ring-2 ring-amber-500 ring-offset-2 ring-offset-slate-50"
          : "hover:border-slate-500 hover:shadow-md",
      ].join(" ")}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-1.5 !w-1.5 !border-0 !bg-slate-300"
      />
      <div className="flex items-center justify-between gap-2 text-[9px] font-semibold uppercase tracking-[0.12em]">
        <span className={isSeed ? "text-slate-900" : "text-slate-400"}>
          {isSeed ? "Seed" : "Citation"}
        </span>
        {data.subtitle && <span className="text-slate-400">{data.subtitle}</span>}
      </div>
      <div
        className={`mt-1.5 line-clamp-3 text-[11px] leading-snug ${
          isSeed ? "font-semibold" : "font-medium"
        }`}
      >
        {data.label}
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-1.5 !w-1.5 !border-0 !bg-slate-300"
      />
    </div>
  );
}

const nodeTypes = { paper: PaperNode };

function DetailPanel({
  paper,
  onClose,
}: {
  paper: ResearchPaper | null;
  onClose: () => void;
}) {
  if (!paper) return null;
  return (
    <aside className="pointer-events-auto absolute right-4 top-4 z-20 flex max-h-[calc(100vh-2rem)] w-[360px] max-w-[90vw] flex-col gap-3 overflow-hidden rounded-2xl border border-slate-200 bg-white/95 p-5 shadow-2xl backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            {paper.source === "arxiv" ? "arXiv paper" : "Cited paper"}
            {paper.year ? ` · ${paper.year}` : ""}
          </div>
          <h2 className="mt-1 text-base font-semibold leading-snug text-slate-900">
            {paper.title}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close detail panel"
          className="-mr-1 -mt-1 shrink-0 rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {paper.authors.length > 0 && (
        <p className="text-xs text-slate-600">
          {paper.authors.slice(0, 6).join(", ")}
          {paper.authors.length > 6
            ? ` and ${paper.authors.length - 6} more`
            : ""}
        </p>
      )}

      {(paper.citationCount != null ||
        (paper.influentialCitationCount != null &&
          paper.influentialCitationCount > 0)) && (
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          {paper.citationCount != null && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">
              {paper.citationCount.toLocaleString()} citations
            </span>
          )}
          {paper.influentialCitationCount != null &&
            paper.influentialCitationCount > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">
                {paper.influentialCitationCount} influential
              </span>
            )}
        </div>
      )}

      {paper.summary && (
        <p className="overflow-y-auto pr-1 text-xs leading-relaxed text-slate-700">
          {paper.summary}
        </p>
      )}

      {paper.url && (
        <a
          href={paper.url}
          target="_blank"
          rel="noreferrer"
          className="mt-auto inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white transition hover:bg-slate-800"
        >
          Open paper
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M7 17 17 7M7 7h10v10" />
          </svg>
        </a>
      )}
    </aside>
  );
}

function StatusPill({
  phase,
  loading,
  nodeCount,
  edgeCount,
}: {
  phase: Phase;
  loading: boolean;
  nodeCount: number;
  edgeCount: number;
}) {
  let dot = "bg-slate-300";
  let label = "Idle";
  if (loading && phase === "idle") {
    dot = "bg-amber-500 animate-pulse";
    label = "Searching arXiv...";
  } else if (loading && phase === "seeds") {
    dot = "bg-amber-500 animate-pulse";
    label = `Fetching citations for ${nodeCount} seeds...`;
  } else if (phase === "seeds") {
    dot = "bg-sky-500";
    label = `Seeds ready · ${nodeCount} nodes`;
  } else if (phase === "citations") {
    dot = "bg-emerald-500";
    label = `Graph ready · ${nodeCount} nodes · ${edgeCount} edges`;
  }
  return (
    <div className="pointer-events-auto absolute left-4 top-4 z-20 flex items-center gap-2 rounded-full border border-slate-200 bg-white/90 px-3 py-1.5 text-xs shadow-sm backdrop-blur">
      <span className="font-semibold text-slate-900">Citation Mapper</span>
      <span className="text-slate-300">·</span>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
      <span className="text-slate-600">{label}</span>
    </div>
  );
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [runId, setRunId] = useState("");
  const [graph, setGraph] = useState<GraphPayload>({ nodes: [], edges: [] });
  const [phase, setPhase] = useState<Phase>("idle");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [flowInstance, setFlowInstance] =
    useState<ReactFlowInstance | null>(null);
  const [selected, setSelected] = useState<ResearchPaper | null>(null);

  useEffect(() => {
    if (!flowInstance || graph.nodes.length === 0) return;
    flowInstance.fitView({ padding: 0.2, duration: 450 });
  }, [flowInstance, graph.edges.length, graph.nodes.length]);

  const runQuery = useCallback(
    async (raw: string) => {
      const nextQuery = raw.trim();
      if (!nextQuery || loading) return;
      setLoading(true);
      setError("");
      setSelected(null);
      setPhase("idle");
      setGraph({ nodes: [], edges: [] });
      try {
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
        if (!seedsRes.ok)
          throw new Error(seedsData.error ?? "Failed to generate seeds");
        setRunId(seedsData.runId);
        setGraph(seedsData.graph);
        setPhase("seeds");

        const citationsRes = await fetch("/api/research/citations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId: seedsData.runId }),
        });
        const citationsData = (await citationsRes.json()) as {
          error?: string;
          graph: GraphPayload;
        };
        if (!citationsRes.ok)
          throw new Error(
            citationsData.error ?? "Failed to generate citations",
          );
        setGraph(citationsData.graph);
        setPhase("citations");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unexpected error");
      } finally {
        setLoading(false);
      }
    },
    [loading],
  );

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runQuery(query);
  };

  const onExample = (example: string) => {
    setQuery(example);
    void runQuery(example);
  };

  const showEmptyState = !loading && graph.nodes.length === 0;

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-slate-50">
      <ReactFlow
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        fitView
        onInit={setFlowInstance}
        onNodeClick={(_, node) => {
          const data = node.data as GraphNodeData;
          setSelected(data.paper ?? null);
        }}
        onPaneClick={() => setSelected(null)}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        minZoom={0.25}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color="#cbd5e1"
        />
        <Controls showInteractive={false} className="!shadow-md" />
      </ReactFlow>

      <StatusPill
        phase={phase}
        loading={loading}
        nodeCount={graph.nodes.length}
        edgeCount={graph.edges.length}
      />

      <DetailPanel paper={selected} onClose={() => setSelected(null)} />

      {showEmptyState && (
        <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center px-6">
          <div className="text-center">
            <div className="text-3xl font-semibold tracking-tight text-slate-400">
              Map a research topic
            </div>
            <div className="mt-2 text-sm text-slate-400">
              Recent arXiv papers + their most-cited references, in one graph.
            </div>
            <div className="pointer-events-auto mt-6 flex flex-wrap justify-center gap-2">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => onExample(example)}
                  className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm transition hover:border-slate-500 hover:text-slate-900"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <section className="pointer-events-none absolute inset-x-0 bottom-0 z-10 p-6">
        <form
          onSubmit={onSubmit}
          className="pointer-events-auto mx-auto flex w-full max-w-3xl items-center gap-2 rounded-2xl border border-slate-200 bg-white/95 p-2.5 shadow-xl backdrop-blur"
        >
          <span className="ml-2 text-slate-400">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Describe a research topic..."
            disabled={loading}
            className="h-11 flex-1 bg-transparent px-1 text-sm text-slate-900 outline-none placeholder:text-slate-400 disabled:opacity-60"
          />
          {query && !loading && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear query"
              className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          )}
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <>
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Mapping
              </>
            ) : (
              "Map"
            )}
          </button>
        </form>

        <div className="pointer-events-none mx-auto mt-2 flex max-w-3xl items-center justify-between gap-3 px-2 text-[11px] text-slate-500">
          <span className="truncate">
            {error ? (
              <span className="text-red-600">{error}</span>
            ) : runId ? (
              <span className="font-mono text-slate-400">{runId}</span>
            ) : (
              <span>Press Enter or hit Map to build the graph.</span>
            )}
          </span>
          {loading && phase === "idle" && (
            <span className="shrink-0 text-slate-500">
              Stage 1 of 2 · arXiv
            </span>
          )}
          {loading && phase === "seeds" && (
            <span className="shrink-0 text-slate-500">
              Stage 2 of 2 · Semantic Scholar + arXiv
            </span>
          )}
        </div>
      </section>
    </main>
  );
}
