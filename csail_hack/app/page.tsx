"use client";

import {
  CSSProperties,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import type {
  AnyNodeData,
  GraphNodeData,
  HaloNodeData,
  ResearchPaper,
  Subtopic,
} from "@/lib/papers";
import "@xyflow/react/dist/style.css";

type GraphPayload = {
  nodes: Node<AnyNodeData>[];
  edges: Edge[];
  subtopics?: Subtopic[];
};
type SummaryCardData = {
  summary?: { oneLine?: string; paragraph?: string };
  methodology?: { methodology?: string; results?: string; futureWork?: string };
  figures?: { figures?: Array<{ imageUrl: string; caption?: string; description?: string }> };
};
type RunsApiResponse = { runs?: string[]; error?: string };
type RunLoadResponse = {
  runId: string;
  query: string;
  graph: GraphPayload;
  error?: string;
};
type Phase = "idle" | "seeds" | "citations";
type PaperNodeType = Node<GraphNodeData, "paper">;
type HaloNodeType = Node<HaloNodeData, "halo">;

const EXAMPLES = [
  "diffusion models for video",
  "graph neural networks",
  "retrieval augmented generation",
  "mechanistic interpretability",
];

// These must match SEED_NODE_SIZE / CITATION_NODE_SIZE in lib/graph.ts so
// dagre reserves the right amount of layout space for them.
const SEED_DIAMETER = 132;
const CITATION_DIAMETER = 96;

const hexToRgba = (hex: string, alpha: number) => {
  const cleaned = hex.replace("#", "");
  if (cleaned.length !== 6) return hex;
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

// Single circular hit-area whose own contents are non-interactive — that
// way React Flow's onNodeMouseEnter / onNodeMouseLeave fire exactly once
// per hover and don't re-trigger as the cursor crosses inner text spans.
//
// Visual hierarchy:
//   - Seed: vibrant cluster-coloured radial fill, white bold title,
//     thin inner highlight ring for "lit" depth, year chip pinned to
//     the bottom of the disc.
//   - Citation: same radial fill but heavily damped (alpha ~0.22) so
//     it reads as a quieter member of the same cluster instead of a
//     hollow dark circle. Slate-200 medium title, no year.
//   - Hover: small scale-up + brighter glow.
//   - Selected: cluster-coloured outline glow (no more amber ring).
function PaperNode({ data, selected }: NodeProps<PaperNodeType>) {
  const isSeed = data.kind === "seed";
  const accent = data.color ?? (isSeed ? "#94a3b8" : "#475569");
  const size = isSeed ? SEED_DIAMETER : CITATION_DIAMETER;

  const background = isSeed
    ? `radial-gradient(circle at 30% 22%, ${hexToRgba(accent, 0.62)} 0%, ${hexToRgba(accent, 0.28)} 55%, ${hexToRgba(accent, 0.1)} 100%)`
    : `radial-gradient(circle at 30% 22%, ${hexToRgba(accent, 0.28)} 0%, ${hexToRgba(accent, 0.1)} 55%, rgba(13,18,32,0.92) 100%)`;

  const borderWidth = isSeed ? 2 : 1.4;
  const borderColor = hexToRgba(accent, isSeed ? 0.95 : 0.75);

  const baseShadow = isSeed
    ? `0 0 0 1px ${hexToRgba(accent, 0.3)}, 0 12px 28px -12px ${hexToRgba(accent, 0.65)}`
    : `0 0 0 1px ${hexToRgba(accent, 0.32)}, 0 6px 16px -10px rgba(0,0,0,0.7)`;
  const selectedShadow = `0 0 0 2px ${hexToRgba(accent, 1)}, 0 0 28px -2px ${hexToRgba(accent, 0.85)}`;

  const titleClass = isSeed
    ? "text-[11px] font-semibold leading-[1.15] line-clamp-3"
    : "text-[10px] font-medium leading-[1.12] line-clamp-3";

  return (
    <div
      role="button"
      aria-label={`${isSeed ? "Seed" : "Citation"}: ${data.label}`}
      className="group relative flex cursor-pointer items-center justify-center rounded-full text-center transition-[transform,box-shadow] duration-200 ease-out hover:z-10 hover:scale-[1.06]"
      style={{
        width: size,
        height: size,
        background,
        border: `${borderWidth}px solid ${borderColor}`,
        boxShadow: selected ? selectedShadow : baseShadow,
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        className="!pointer-events-none !h-1.5 !w-1.5 !border-0 !bg-slate-500/60"
      />

      {/* Inner highlight ring — only on seeds, gives the disc a "lit"
          look that helps it pop against the cluster halo. */}
      {isSeed && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-[5px] rounded-full"
          style={{
            border: `1px solid ${hexToRgba("#ffffff", 0.1)}`,
            background: `radial-gradient(circle at 30% 18%, ${hexToRgba("#ffffff", 0.12)}, ${hexToRgba("#ffffff", 0)} 55%)`,
          }}
        />
      )}

      <div
        className="pointer-events-none relative z-[1] flex h-full w-full flex-col items-center justify-center gap-1.5 px-2.5"
        style={{ color: isSeed ? "#f8fafc" : "#e2e8f0" }}
      >
        <div
          className={`${titleClass} break-words tracking-tight`}
          style={{
            textShadow: isSeed
              ? "0 1px 3px rgba(0,0,0,0.55)"
              : "0 1px 2px rgba(0,0,0,0.5)",
          }}
        >
          {data.label}
        </div>

        {/* Year pill on seeds only — citations don't have it because their
            disc is too small for a legible second row of text. */}
        {isSeed && data.subtitle && (
          <div
            className="rounded-full px-2 py-[1px] text-[9px] font-bold tracking-[0.12em]"
            style={{
              background: hexToRgba("#0f172a", 0.55),
              color: hexToRgba(accent, 0.95),
              border: `1px solid ${hexToRgba(accent, 0.4)}`,
            }}
          >
            {data.subtitle}
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className="!pointer-events-none !h-1.5 !w-1.5 !border-0 !bg-slate-500/60"
      />
    </div>
  );
}

// Translucent disc rendered behind each cluster so the topic boundary
// is visible at a glance. Non-interactive — pointer events pass through
// to the paper nodes inside.
function HaloNode({ data }: NodeProps<HaloNodeType>) {
  const { color, label, diameter } = data;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none relative"
      style={{ width: diameter, height: diameter }}
    >
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: `radial-gradient(circle at 50% 45%, ${hexToRgba(color, 0.16)}, ${hexToRgba(color, 0.06)} 70%, ${hexToRgba(color, 0)} 100%)`,
          border: `1px dashed ${hexToRgba(color, 0.35)}`,
          boxShadow: `inset 0 0 60px -10px ${hexToRgba(color, 0.18)}`,
        }}
      />
      <div
        className="absolute left-1/2 top-3 -translate-x-1/2 whitespace-nowrap rounded-full px-3 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em]"
        style={{
          background: hexToRgba(color, 0.22),
          color: hexToRgba(color, 0.95),
          border: `1px solid ${hexToRgba(color, 0.35)}`,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function DetailPanel({
  paper,
  card,
  onClose,
}: {
  paper: ResearchPaper | null;
  card: SummaryCardData | null;
  onClose: () => void;
}) {
  if (!paper) return null;
  const title = card?.summary?.oneLine?.trim() || paper.title;
  const paragraph = card?.summary?.paragraph?.trim() || paper.summary;
  const methodology = card?.methodology?.methodology?.trim() ?? "";
  const results = card?.methodology?.results?.trim() ?? "";
  const futureWork = card?.methodology?.futureWork?.trim() ?? "";
  const figures = card?.figures?.figures ?? [];
  return (
    <aside className="pointer-events-auto absolute right-0 top-0 z-20 flex h-full w-[50vw] min-w-[520px] max-w-[980px] flex-col gap-3 overflow-y-auto border-l border-slate-700/80 bg-slate-900/96 p-6 text-slate-100 shadow-2xl backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
            {paper.source === "arxiv" ? "arXiv paper" : "Cited paper"}
            {paper.year ? ` · ${paper.year}` : ""}
          </div>
          <h2 className="mt-1 text-base font-semibold leading-snug text-slate-50">
            {title}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close detail panel"
          className="-mr-1 -mt-1 shrink-0 rounded-full p-1 text-slate-500 transition hover:bg-slate-800 hover:text-slate-200"
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
        <p className="text-xs text-slate-400">
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
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-slate-300">
              {paper.citationCount.toLocaleString()} citations
            </span>
          )}
          {paper.influentialCitationCount != null &&
            paper.influentialCitationCount > 0 && (
              <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-amber-300">
                {paper.influentialCitationCount} influential
              </span>
            )}
        </div>
      )}

      {paragraph && (
        <p className="pr-1 text-xs leading-relaxed text-slate-300">
          {paragraph}
        </p>
      )}

      {figures.length > 0 && (
        <section className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
            Figures
          </h3>
          <div className="space-y-3">
            {figures.map((figure, index) => (
              <article key={`${figure.imageUrl}-${index}`} className="space-y-1.5">
                <img
                  src={figure.imageUrl}
                  alt={figure.caption ?? `Figure ${index + 1}`}
                  className="w-full rounded-lg border border-slate-700/80 bg-slate-900 object-contain"
                  loading="lazy"
                />
                {figure.caption && (
                  <p className="text-[11px] leading-relaxed text-slate-300">{figure.caption}</p>
                )}
                {figure.description && (
                  <p className="text-[11px] leading-relaxed text-slate-400">
                    {figure.description}
                  </p>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {methodology && (
        <section className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
            Methodology
          </h3>
          <p className="text-xs leading-relaxed text-slate-300">{methodology}</p>
        </section>
      )}

      {results && (
        <section className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
            Results
          </h3>
          <p className="text-xs leading-relaxed text-slate-300">{results}</p>
        </section>
      )}

      {futureWork && (
        <section className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
            Future Work
          </h3>
          <p className="text-xs leading-relaxed text-slate-300">{futureWork}</p>
        </section>
      )}

      {paper.url && (
        <a
          href={paper.url}
          target="_blank"
          rel="noreferrer"
          className="mt-auto inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium text-slate-900 transition hover:bg-white"
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
  subtopicCount,
}: {
  phase: Phase;
  loading: boolean;
  nodeCount: number;
  edgeCount: number;
  subtopicCount: number;
}) {
  let dot = "bg-slate-600";
  let label = "Idle";
  if (loading && phase === "idle") {
    dot = "bg-amber-400 animate-pulse";
    label = "Searching arXiv...";
  } else if (loading && phase === "seeds") {
    dot = "bg-amber-400 animate-pulse";
    label = `Fetching citations for ${nodeCount} seeds...`;
  } else if (phase === "seeds") {
    dot = "bg-sky-400";
    label = `Seeds ready · ${nodeCount} nodes`;
  } else if (phase === "citations") {
    dot = "bg-emerald-400";
    label =
      subtopicCount > 0
        ? `${subtopicCount} subtopics · ${nodeCount} nodes · ${edgeCount} edges`
        : `Graph ready · ${nodeCount} nodes · ${edgeCount} edges`;
  }
  return (
    <div className="pointer-events-auto absolute left-4 top-4 z-20 flex items-center gap-2 rounded-full border border-slate-700/80 bg-slate-900/85 px-3 py-1.5 text-xs text-slate-300 shadow-lg backdrop-blur">
      <span className="font-semibold text-slate-100">Citation Mapper</span>
      <span className="text-slate-600">·</span>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
      <span>{label}</span>
    </div>
  );
}

function SubtopicLegend({
  subtopics,
  hoveredColor,
  onHover,
}: {
  subtopics: Subtopic[];
  hoveredColor: string | null;
  onHover: (color: string | null) => void;
}) {
  if (subtopics.length === 0) return null;
  return (
    <div className="pointer-events-auto absolute left-4 top-14 z-20 flex max-w-[260px] flex-col gap-1 rounded-2xl border border-slate-700/80 bg-slate-900/85 p-2.5 text-xs text-slate-200 shadow-lg backdrop-blur">
      <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
        Subtopics
      </div>
      {subtopics.map((topic) => {
        const isActive = hoveredColor === null || hoveredColor === topic.color;
        return (
          <button
            key={topic.color + topic.label}
            type="button"
            onMouseEnter={() => onHover(topic.color)}
            onMouseLeave={() => onHover(null)}
            className="flex items-center gap-2 rounded-lg px-2 py-1 text-left transition hover:bg-slate-800"
            style={{ opacity: isActive ? 1 : 0.35 }}
          >
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: topic.color, boxShadow: `0 0 8px ${topic.color}80` }}
              aria-hidden
            />
            <span className="truncate text-slate-100">{topic.label}</span>
            <span className="ml-auto pl-1 text-[10px] text-slate-500">
              {topic.seedIds.length}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [runId, setRunId] = useState("");
  const [graph, setGraph] = useState<GraphPayload>({ nodes: [], edges: [] });
  const [phase, setPhase] = useState<Phase>("idle");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [summaryStatus, setSummaryStatus] = useState("");
  const [runningSummaryCards, setRunningSummaryCards] = useState(false);
  const [flowInstance, setFlowInstance] =
    useState<ReactFlowInstance | null>(null);
  const [selected, setSelected] = useState<ResearchPaper | null>(null);
  const [selectedCard, setSelectedCard] = useState<SummaryCardData | null>(null);
  const [summaryCardsByPaperId, setSummaryCardsByPaperId] = useState<
    Record<string, SummaryCardData>
  >({});
  const [runsMenuOpen, setRunsMenuOpen] = useState(false);
  const [availableRuns, setAvailableRuns] = useState<string[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoveredCluster, setHoveredCluster] = useState<string | null>(null);

  // Debounce hover state changes so the cursor briefly crossing dead space
  // between nodes / edges / handles doesn't make the BFS dim flicker. Mouse-
  // enter clears any pending leave; mouse-leave only commits after a short
  // grace period.
  const hoverLeaveTimer = useRef<number | null>(null);
  const setHoverNode = useCallback((id: string | null) => {
    if (id !== null) {
      if (hoverLeaveTimer.current !== null) {
        window.clearTimeout(hoverLeaveTimer.current);
        hoverLeaveTimer.current = null;
      }
      setHoveredId(id);
      return;
    }
    if (hoverLeaveTimer.current !== null) {
      window.clearTimeout(hoverLeaveTimer.current);
    }
    hoverLeaveTimer.current = window.setTimeout(() => {
      setHoveredId(null);
      hoverLeaveTimer.current = null;
    }, 140);
  }, []);
  useEffect(() => {
    return () => {
      if (hoverLeaveTimer.current !== null) {
        window.clearTimeout(hoverLeaveTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!flowInstance || graph.nodes.length === 0) return;
    flowInstance.fitView({ padding: 0.2, duration: 450 });
  }, [flowInstance, graph.edges.length, graph.nodes.length]);

  // Memoizing inside the component keeps the reference stable across Fast
  // Refresh reloads, which silences React Flow's "new nodeTypes object"
  // warning and prevents subtle node re-mounts on each render.
  const nodeTypes = useMemo(() => ({ paper: PaperNode, halo: HaloNode }), []);

  const subtopics = graph.subtopics ?? [];
  // Halos are decoration, not real graph members — exclude them from
  // status counts and "empty graph" detection.
  const paperNodeCount = useMemo(
    () => graph.nodes.filter((n) => n.type !== "halo").length,
    [graph.nodes],
  );

  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>();
    // Halos aren't real graph members — skip them so they never appear
    // in the BFS frontier and never get dimmed when a paper is hovered.
    for (const node of graph.nodes) {
      if (node.type === "halo") continue;
      map.set(node.id, new Set());
    }
    for (const edge of graph.edges) {
      map.get(edge.source)?.add(edge.target);
      map.get(edge.target)?.add(edge.source);
    }
    return map;
  }, [graph.edges, graph.nodes]);

  // BFS to depth 2 so hovering a seed reveals its citations *and* the
  // other seeds that share those citations, and hovering a citation
  // reveals its parent seeds *and* their other citations.
  const connectedIds = useMemo(() => {
    if (hoveredCluster) {
      const clusterSeeds = new Set(
        subtopics.find((s) => s.color === hoveredCluster)?.seedIds ?? [],
      );
      if (clusterSeeds.size === 0) return null;
      const visited = new Set<string>(clusterSeeds);
      for (const id of clusterSeeds) {
        for (const neighbor of adjacency.get(id) ?? []) visited.add(neighbor);
      }
      return visited;
    }
    if (!hoveredId) return null;
    const visited = new Set<string>([hoveredId]);
    let frontier: string[] = [hoveredId];
    for (let depth = 0; depth < 2 && frontier.length > 0; depth += 1) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const neighbor of adjacency.get(id) ?? []) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            next.push(neighbor);
          }
        }
      }
      frontier = next;
    }
    return visited;
  }, [adjacency, hoveredId, hoveredCluster, subtopics]);

  const displayNodes = useMemo(() => {
    if (!connectedIds) return graph.nodes;
    return graph.nodes.map((node) => {
      // Halos are decoration — keep them at full opacity always so the
      // topic regions stay visible even while a single subgraph is
      // isolated by hover.
      if (node.type === "halo") return node;
      const active = connectedIds.has(node.id);
      const pe: CSSProperties["pointerEvents"] = active ? "auto" : "none";
      return {
        ...node,
        // Dimmed nodes go pointer-events:none so the cursor can't accidentally
        // re-trigger onNodeMouseEnter on a faded neighbour while the user is
        // sweeping across the active subgraph. This is the main fix for the
        // "hover keeps jumping to other nodes" glitch.
        style: {
          ...node.style,
          opacity: active ? 1 : 0.18,
          pointerEvents: pe,
        },
      };
    });
  }, [connectedIds, graph.nodes]);

  const displayEdges = useMemo(() => {
    if (!connectedIds) return graph.edges;
    return graph.edges.map((edge) => {
      const active =
        connectedIds.has(edge.source) && connectedIds.has(edge.target);
      const pe: CSSProperties["pointerEvents"] = active ? "auto" : "none";
      return {
        ...edge,
        style: {
          ...edge.style,
          opacity: active ? 0.95 : 0.05,
          pointerEvents: pe,
        },
      };
    });
  }, [connectedIds, graph.edges]);

  const runQuery = useCallback(
    async (raw: string) => {
      const nextQuery = raw.trim();
      if (!nextQuery || loading) return;
      setLoading(true);
      setError("");
      setSelected(null);
      setSelectedCard(null);
      setSummaryCardsByPaperId({});
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
        setActiveQuery(nextQuery);
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

  const loadSummaryCards = useCallback(async () => {
    if (!runId) return {};
    const cardsResponse = await fetch(
      `/api/research/summary-card?runId=${encodeURIComponent(runId)}`,
    );
    if (!cardsResponse.ok) return {};
    const payload = (await cardsResponse.json()) as {
      cards?: Array<{ paperId: string; card: SummaryCardData }>;
    };
    const index = Object.fromEntries(
      (payload.cards ?? []).map((entry) => [entry.paperId, entry.card]),
    ) as Record<string, SummaryCardData>;
    setSummaryCardsByPaperId(index);
    return index;
  }, [runId]);

  const runSummaryCards = async () => {
    if (!runId || runningSummaryCards) return;
    setRunningSummaryCards(true);
    setSummaryStatus("");
    setError("");
    try {
      const response = await fetch("/api/research/summary-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, query: activeQuery || query }),
      });
      const data = (await response.json()) as { error?: string; processed?: number };
      if (!response.ok) throw new Error(data.error ?? "Failed to run summary cards");
      setSummaryStatus(`Summary cards complete (${data.processed ?? 0} papers).`);
      await loadSummaryCards();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setRunningSummaryCards(false);
    }
  };

  const loadRuns = useCallback(async () => {
    setLoadingRuns(true);
    try {
      const response = await fetch("/api/research/runs");
      const data = (await response.json()) as RunsApiResponse;
      if (!response.ok) throw new Error(data.error ?? "Failed to load runs");
      setAvailableRuns(data.runs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load runs");
    } finally {
      setLoadingRuns(false);
    }
  }, []);

  const loadExistingRun = useCallback(
    async (nextRunId: string) => {
      setError("");
      setSelected(null);
      setSelectedCard(null);
      setRunsMenuOpen(false);
      try {
        const response = await fetch(
          `/api/research/runs?runId=${encodeURIComponent(nextRunId)}`,
        );
        const data = (await response.json()) as RunLoadResponse;
        if (!response.ok) throw new Error(data.error ?? "Failed to load run");
        setRunId(data.runId);
        setActiveQuery(data.query ?? "");
        setQuery(data.query ?? "");
        setGraph(data.graph);
        setPhase("citations");
        setSummaryStatus("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load run");
      }
    },
    [],
  );

  const showEmptyState = !loading && paperNodeCount === 0;

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
      <ReactFlow
        nodes={displayNodes}
        edges={displayEdges}
        nodeTypes={nodeTypes}
        fitView
        onInit={setFlowInstance}
        onNodeClick={(_, node) => {
          if (node.type === "halo") return;
          const data = node.data as GraphNodeData;
          const paper = data.paper ?? null;
          setSelected(paper);
          if (!paper) {
            setSelectedCard(null);
            return;
          }
          const existing = summaryCardsByPaperId[paper.id] ?? null;
          setSelectedCard(existing);
          if (!existing && runId) {
            void loadSummaryCards().then((index) => {
              setSelectedCard(index[paper.id] ?? null);
            });
          }
        }}
        onNodeMouseEnter={(_, node) => {
          if (node.type === "halo") return;
          setHoverNode(node.id);
        }}
        onNodeMouseLeave={() => setHoverNode(null)}
        onPaneMouseLeave={() => setHoverNode(null)}
        onPaneClick={() => {
          setSelected(null);
          setSelectedCard(null);
        }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        minZoom={0.05}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={28}
          size={1}
          color="#1e293b"
        />
        <Controls
          showInteractive={false}
          className="!shadow-lg [&>button]:!border-slate-700 [&>button]:!bg-slate-900 [&>button]:!text-slate-200 [&>button:hover]:!bg-slate-800"
        />
      </ReactFlow>

      <StatusPill
        phase={phase}
        loading={loading}
        nodeCount={paperNodeCount}
        edgeCount={graph.edges.length}
        subtopicCount={subtopics.length}
      />

      <div className="pointer-events-auto absolute left-4 top-24 z-30">
        <button
          type="button"
          onClick={() => {
            const nextOpen = !runsMenuOpen;
            setRunsMenuOpen(nextOpen);
            if (nextOpen && availableRuns.length === 0) void loadRuns();
          }}
          aria-label="Open previous runs menu"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700/80 bg-slate-900/90 text-slate-200 shadow-lg transition hover:bg-slate-800"
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
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        </button>
        {runsMenuOpen && (
          <div className="mt-2 max-h-[50vh] w-[340px] overflow-y-auto rounded-xl border border-slate-700/80 bg-slate-900/95 p-2 text-xs shadow-2xl backdrop-blur">
            <div className="mb-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
              Previous Runs
            </div>
            {loadingRuns ? (
              <div className="px-2 py-2 text-slate-400">Loading...</div>
            ) : availableRuns.length === 0 ? (
              <div className="px-2 py-2 text-slate-500">No runs found.</div>
            ) : (
              availableRuns.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => void loadExistingRun(item)}
                  className="block w-full truncate rounded-lg px-2 py-2 text-left text-slate-200 transition hover:bg-slate-800"
                  title={item}
                >
                  {item}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <SubtopicLegend
        subtopics={subtopics}
        hoveredColor={hoveredCluster}
        onHover={setHoveredCluster}
      />

      <DetailPanel
        paper={selected}
        card={selectedCard}
        onClose={() => {
          setSelected(null);
          setSelectedCard(null);
        }}
      />

      {showEmptyState && (
        <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center px-6">
          <div className="text-center">
            <div className="text-3xl font-semibold tracking-tight text-slate-300">
              Map a research topic
            </div>
            <div className="mt-2 text-sm text-slate-500">
              Recent arXiv papers + their most-cited references, in one graph.
            </div>
            <div className="pointer-events-auto mt-6 flex flex-wrap justify-center gap-2">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => onExample(example)}
                  className="rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1.5 text-xs text-slate-300 shadow-sm backdrop-blur transition hover:border-slate-500 hover:bg-slate-800 hover:text-slate-100"
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
          className="pointer-events-auto mx-auto flex w-full max-w-3xl items-center gap-2 rounded-2xl border border-slate-700/80 bg-slate-900/95 p-2.5 shadow-2xl backdrop-blur"
        >
          <span className="ml-2 text-slate-500">
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
            className="h-11 flex-1 bg-transparent px-1 text-sm text-slate-100 outline-none placeholder:text-slate-500 disabled:opacity-60"
          />
          {query && !loading && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear query"
              className="rounded-md p-1 text-slate-500 transition hover:bg-slate-800 hover:text-slate-200"
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
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-slate-100 px-4 text-sm font-medium text-slate-900 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? (
              <>
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-400 border-t-slate-900" />
                Mapping
              </>
            ) : (
              "Map"
            )}
          </button>
          <button
            type="button"
            onClick={() => void runSummaryCards()}
            disabled={loading || runningSummaryCards || !runId || phase !== "citations"}
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 transition hover:border-slate-500 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {runningSummaryCards ? "Running..." : "Summary Card"}
          </button>
        </form>

        <div className="pointer-events-none mx-auto mt-2 flex max-w-3xl items-center justify-between gap-3 px-2 text-[11px] text-slate-500">
          <span className="truncate">
            {error ? (
              <span className="text-rose-400">{error}</span>
            ) : runId ? (
              <span className="font-mono text-slate-600">{runId}</span>
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
          {!loading && summaryStatus && (
            <span className="shrink-0 text-emerald-600">{summaryStatus}</span>
          )}
        </div>
      </section>
    </main>
  );
}
