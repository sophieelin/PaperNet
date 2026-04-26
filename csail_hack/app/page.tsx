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

/** Total papers in this subtopic (seeds + citations) from metadata + graph nodes. */
function subtopicPaperTotal(topic: Subtopic, nodes: Node<AnyNodeData>[]): number {
  const seeds = topic.seedIds.length;
  const citations = nodes.filter((n) => {
    if (n.type !== "paper") return false;
    const d = n.data as GraphNodeData;
    return d.kind === "citation" && d.color === topic.color;
  }).length;
  return seeds + citations;
}
type EdgeViewMode = "citation" | "semantic";
type SummaryCardData = {
  summary?: { oneLine?: string; paragraph?: string };
  methodology?: { methodology?: string; results?: string; futureWork?: string };
  figures?: { figures?: Array<{ imageUrl: string; caption?: string; description?: string }> };
  bibtex?: string;
};
type IdeationData = {
  exploredDirections: string[];
  futureDirections: string[];
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
    : `radial-gradient(circle at 30% 22%, ${hexToRgba(accent, 0.3)} 0%, ${hexToRgba(accent, 0.12)} 52%, rgba(10,11,14,0.96) 100%)`;

  const borderWidth = isSeed ? 2 : 1.4;
  const borderColor = hexToRgba(accent, isSeed ? 0.95 : 0.75);

  const baseShadow = isSeed
    ? `0 0 0 1px ${hexToRgba(accent, 0.32)}, 0 1px 0 ${hexToRgba("#ffffff", 0.08)} inset, 0 14px 32px -14px ${hexToRgba(accent, 0.7)}`
    : `0 0 0 1px ${hexToRgba(accent, 0.28)}, 0 1px 0 ${hexToRgba("#ffffff", 0.04)} inset, 0 8px 20px -12px rgba(0,0,0,0.75)`;
  const selectedShadow = `0 0 0 2px ${hexToRgba(accent, 1)}, 0 0 0 1px ${hexToRgba("#fff", 0.12)} inset, 0 0 32px -4px ${hexToRgba(accent, 0.85)}`;

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
        className="!pointer-events-none !h-1.5 !w-1.5 !border-0"
        style={{ background: "rgba(220, 215, 200, 0.35)" }}
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
        style={{ color: isSeed ? "#f4f1ea" : "#dfe6eb" }}
      >
        <div
          className={`${titleClass} break-words tracking-tight`}
          style={{
            textShadow: isSeed
              ? "0 1px 3px rgba(0,0,0,0.5)"
              : "0 1px 2px rgba(0,0,0,0.45)",
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
              background: "rgba(8, 9, 11, 0.58)",
              color: hexToRgba(accent, 0.95),
              border: `1px solid ${hexToRgba(accent, 0.42)}`,
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
        className="!pointer-events-none !h-1.5 !w-1.5 !border-0"
        style={{ background: "rgba(220, 215, 200, 0.35)" }}
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
          background: `radial-gradient(circle at 50% 42%, ${hexToRgba(color, 0.18)}, ${hexToRgba(color, 0.07)} 68%, ${hexToRgba(color, 0)} 100%)`,
          border: `1px dashed ${hexToRgba(color, 0.32)}`,
          boxShadow: `inset 0 0 64px -12px ${hexToRgba(color, 0.2)}`,
        }}
      />
      <div
        className="absolute left-1/2 top-3 -translate-x-1/2 whitespace-nowrap rounded-full px-3.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]"
        style={{
          background: hexToRgba(color, 0.2),
          color: hexToRgba(color, 0.98),
          border: `1px solid ${hexToRgba(color, 0.38)}`,
          boxShadow: `0 1px 0 ${hexToRgba("#fff", 0.06)} inset`,
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
  const [copiedBibtex, setCopiedBibtex] = useState(false);
  if (!paper) return null;
  const title = card?.summary?.oneLine?.trim() || paper.title;
  const paragraph = card?.summary?.paragraph?.trim() || paper.summary;
  const methodology = card?.methodology?.methodology?.trim() ?? "";
  const results = card?.methodology?.results?.trim() ?? "";
  const futureWork = card?.methodology?.futureWork?.trim() ?? "";
  const figures = card?.figures?.figures ?? [];
  const bibtex = card?.bibtex?.trim() ?? "";
  return (
    <aside
      className="scroll-fine pointer-events-auto absolute right-0 top-0 z-[70] flex h-full w-[44vw] min-w-[460px] max-w-[820px] flex-col overflow-y-auto"
      style={{
        background: "var(--bg-elev)",
        borderLeft: "1px solid var(--line)",
      }}
    >
      {/* Sticky header so the title stays put as the reader scrolls. */}
      <div
        className="sticky top-0 z-10 flex items-start justify-between gap-3 px-7 pb-4 pt-6"
        style={{
          background: "var(--bg-elev)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div className="min-w-0 flex-1">
          <div className="label-eyebrow">
            {paper.source === "arxiv" ? "arXiv" : "Cited paper"}
            {paper.year ? ` · ${paper.year}` : ""}
          </div>
          <h2
            className="font-serif mt-2 text-[22px] font-semibold leading-[1.2] tracking-tight"
            style={{ color: "var(--text)" }}
          >
            {title}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close detail panel"
          className="shrink-0 p-1 transition hover:bg-white/5"
          style={{ color: "var(--text-muted)" }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-6 px-7 pb-8 pt-6">
        {paper.authors.length > 0 && (
          <p
            className="text-[13px] italic leading-relaxed"
            style={{ color: "var(--text-muted)" }}
          >
            {paper.authors.slice(0, 6).join(", ")}
            {paper.authors.length > 6
              ? `, and ${paper.authors.length - 6} more`
              : ""}
          </p>
        )}

        {(paper.citationCount != null ||
          (paper.influentialCitationCount != null &&
            paper.influentialCitationCount > 0)) && (
          <div
            className="flex flex-wrap items-baseline gap-x-6 gap-y-1 pb-1 text-[12px]"
            style={{ color: "var(--text-muted)" }}
          >
            {paper.citationCount != null && (
              <span>
                <span
                  className="tabular-nums"
                  style={{ color: "var(--text)", fontSize: 14 }}
                >
                  {paper.citationCount.toLocaleString()}
                </span>{" "}
                citations
              </span>
            )}
            {paper.influentialCitationCount != null &&
              paper.influentialCitationCount > 0 && (
                <span>
                  <span
                    className="tabular-nums"
                    style={{ color: "var(--accent)", fontSize: 14 }}
                  >
                    {paper.influentialCitationCount}
                  </span>{" "}
                  influential
                </span>
              )}
          </div>
        )}

        {paragraph && (
          <p
            className="text-[14px] leading-[1.6]"
            style={{ color: "var(--text)" }}
          >
            {paragraph}
          </p>
        )}

        {figures.length > 0 && (
          <Section label="Figures">
            <div className="space-y-5">
              {figures.map((figure, index) => (
                <figure
                  key={`${figure.imageUrl}-${index}`}
                  className="space-y-2"
                >
                  {/*
                   * White matting around the figure so transparent or
                   * light-on-light scientific figures render correctly.
                   * The previous bg-slate-900 swallowed PNGs with
                   * transparent backgrounds.
                   */}
                  <div
                    className="overflow-hidden"
                    style={{
                      background: "#ffffff",
                      border: "1px solid var(--line)",
                      padding: 10,
                    }}
                  >
                    <img
                      src={figure.imageUrl}
                      alt={figure.caption ?? `Figure ${index + 1}`}
                      className="block w-full object-contain"
                      style={{ background: "#ffffff" }}
                      loading="lazy"
                    />
                  </div>
                  {(figure.caption || figure.description) && (
                    <figcaption className="space-y-1 text-[12px] leading-relaxed">
                      {figure.caption && (
                        <p style={{ color: "var(--text)" }}>
                          <span
                            className="mr-1 italic"
                            style={{ color: "var(--text-muted)" }}
                          >
                            Fig. {index + 1}.
                          </span>
                          {figure.caption}
                        </p>
                      )}
                      {figure.description && (
                        <p style={{ color: "var(--text-muted)" }}>
                          {figure.description}
                        </p>
                      )}
                    </figcaption>
                  )}
                </figure>
              ))}
            </div>
          </Section>
        )}

        {methodology && (
          <Section label="Methodology">
            <p
              className="text-[13px] leading-[1.65]"
              style={{ color: "var(--text)" }}
            >
              {methodology}
            </p>
          </Section>
        )}

        {results && (
          <Section label="Results">
            <p
              className="text-[13px] leading-[1.65]"
              style={{ color: "var(--text)" }}
            >
              {results}
            </p>
          </Section>
        )}

        {futureWork && (
          <Section label="Future work">
            <p
              className="text-[13px] leading-[1.65]"
              style={{ color: "var(--text)" }}
            >
              {futureWork}
            </p>
          </Section>
        )}

        {bibtex && (
        <section className="pt-5" style={{ borderTop: "1px solid var(--line)" }}>
            <div className="mb-3 flex items-center justify-between">
              <div className="label-eyebrow">BibTeX</div>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(bibtex);
                    setCopiedBibtex(true);
                    window.setTimeout(() => setCopiedBibtex(false), 1200);
                  } catch {
                    setCopiedBibtex(false);
                  }
                }}
                className="rounded p-1 transition hover:bg-white/5"
                style={{
                  border: "1px solid var(--line)",
                  color: "var(--text-muted)",
                }}
                aria-label={copiedBibtex ? "BibTeX copied" : "Copy BibTeX"}
                title={copiedBibtex ? "Copied" : "Copy BibTeX"}
              >
                {copiedBibtex ? (
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m20 6-11 11-5-5" />
                  </svg>
                ) : (
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                )}
              </button>
            </div>
            <pre
              className="overflow-x-auto whitespace-pre-wrap break-words rounded p-2 text-[11px] leading-relaxed"
              style={{
                background: "var(--bg)",
                color: "var(--text-muted)",
              }}
            >
              {bibtex}
            </pre>
          </section>
        )}

        {paper.url && (
          <a
            href={paper.url}
            target="_blank"
            rel="noreferrer"
            className="mt-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 text-[12px] uppercase tracking-[0.18em] transition hover:opacity-90"
            style={{
              background: "var(--accent)",
              color: "#1a1207",
              fontWeight: 500,
            }}
          >
            Read paper
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
      </div>
    </aside>
  );
}

// Hairline-divided section with an editorial label. Replaces the previous
// bordered card-in-card boxes that gave the panel a "form" feel.
function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="pt-5" style={{ borderTop: "1px solid var(--line)" }}>
      <div className="label-eyebrow mb-3">{label}</div>
      {children}
    </section>
  );
}

// Top masthead — replaces the previous floating "PaperNet" status pill with
// a thin hairline bar that runs across the top of the canvas. The Playfair
// wordmark and the eyebrow stat row read more like a publication than a
// dashboard, which was the request: "looks AI-generated".
function Masthead({
  loading,
  phase,
  nodeCount,
  edgeCount,
  subtopicCount,
  statusText,
  statusBusy,
  onToggleRuns,
  runsOpen,
  activeQuery,
}: {
  loading: boolean;
  phase: Phase;
  nodeCount: number;
  edgeCount: number;
  subtopicCount: number;
  statusText: string;
  statusBusy: boolean;
  onToggleRuns: () => void;
  runsOpen: boolean;
  activeQuery: string;
}) {
  let dot: string = "rgba(255,255,255,0.18)";
  if (loading) dot = "var(--accent)";
  else if (phase === "seeds") dot = "#9bb1c2";
  else if (phase === "citations") dot = "var(--accent)";

  return (
    <header
      className="pointer-events-auto absolute inset-x-0 top-0 z-30 flex items-center justify-between gap-4 border-b px-5 py-3 text-[color:var(--text)]"
      style={{
        background: "rgba(12, 13, 16, 0.78)",
        borderColor: "var(--line)",
        backdropFilter: "blur(6px)",
      }}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onToggleRuns}
          aria-label="Toggle previous runs"
          aria-expanded={runsOpen}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[color:var(--text-muted)] transition hover:bg-white/5 hover:text-[color:var(--text)]"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          >
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        </button>
        <div className="flex items-baseline gap-2">
          <span className="font-serif text-[18px] font-semibold leading-none tracking-tight text-[color:var(--text)]">
            PaperNet
          </span>
        </div>
      </div>

      <div className="hidden items-center gap-5 text-[11px] sm:flex">
        {activeQuery && (
          <span
            className="max-w-[28ch] truncate text-[12px] font-medium"
            style={{ color: "var(--text-muted)" }}
            title={activeQuery}
          >
            &ldquo;{activeQuery}&rdquo;
          </span>
        )}
        <Stat label="Papers" value={nodeCount} />
        <Stat label="Edges" value={edgeCount} />
        <Stat label="Topics" value={subtopicCount} />
        <span
          className="inline-flex items-center gap-2"
          style={{ color: "var(--text-muted)" }}
        >
          <span
            className={statusBusy ? "animate-pulse" : ""}
            style={{
              display: "inline-block",
              height: 6,
              width: 6,
              borderRadius: 999,
              background: dot,
            }}
          />
          <span className="text-[11px] tracking-wide">{statusText || "Idle"}</span>
        </span>
      </div>
    </header>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span
        className="text-[14px] font-medium tabular-nums"
        style={{ color: "var(--text)" }}
      >
        {value}
      </span>
      <span
        className="text-[10px] uppercase tracking-[0.2em]"
        style={{ color: "var(--text-faint)" }}
      >
        {label}
      </span>
    </span>
  );
}

function SubtopicLegend({
  subtopics,
  graphNodes,
  hoveredColor,
  onHover,
  collapsed,
  onToggleCollapsed,
  showSemanticLegend,
}: {
  subtopics: Subtopic[];
  graphNodes: Node<AnyNodeData>[];
  hoveredColor: string | null;
  onHover: (color: string | null) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  showSemanticLegend: boolean;
}) {
  if (subtopics.length === 0 && !showSemanticLegend) return null;
  return (
    <aside
      className="pointer-events-auto absolute left-5 top-[68px] z-20 flex w-[260px] flex-col gap-px border text-[12px]"
      style={{
        background: "var(--bg-elev)",
        borderColor: "var(--line)",
      }}
    >
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="flex items-center justify-between px-3 py-2 text-left transition hover:bg-white/5"
      >
        <span className="label-eyebrow">Topics</span>
        <span style={{ color: "var(--text-faint)", fontSize: 12 }}>
          {collapsed ? "+" : "−"}
        </span>
      </button>
      {!collapsed &&
        subtopics.map((topic) => {
          const isActive = hoveredColor === null || hoveredColor === topic.color;
          const total = subtopicPaperTotal(topic, graphNodes);
          return (
            <button
              key={topic.color + topic.label}
              type="button"
              onMouseEnter={() => onHover(topic.color)}
              onMouseLeave={() => onHover(null)}
              className="flex items-center gap-2.5 px-3 py-1.5 text-left transition hover:bg-white/5"
              style={{ opacity: isActive ? 1 : 0.4 }}
              aria-label={`${topic.label}: ${total} papers`}
            >
              <span
                className="inline-block h-[7px] w-[7px] shrink-0 rounded-sm"
                style={{ background: topic.color }}
                aria-hidden
              />
              <span
                className="min-w-0 truncate"
                style={{ color: "var(--text)" }}
              >
                {topic.label}
              </span>
              <span
                className="ml-auto shrink-0 pl-1 text-[10px] tabular-nums leading-none"
                style={{ color: "var(--text)" }}
                title={`${total} paper${total === 1 ? "" : "s"} in this topic`}
              >
                {total}
              </span>
            </button>
          );
        })}
      {showSemanticLegend && (
        <div
          className="mt-px px-3 pb-2 pt-2"
          style={{ borderTop: "1px solid var(--line)" }}
        >
          <div className="label-eyebrow pb-1.5">Semantic Edges</div>
          {[
            { name: "Builds on", color: "#9bb37c", dash: "" },
            { name: "Similar approach", color: "#9eb1c2", dash: "4 2" },
            { name: "Contrasting", color: "#c79373", dash: "2 2" },
          ].map((item) => (
            <div
              key={item.name}
              className="flex items-center gap-2 py-0.5"
            >
              <span
                className="inline-block h-px w-7"
                style={{
                  background: item.color,
                  borderTop: item.dash ? `1px dashed ${item.color}` : undefined,
                }}
              />
              <span style={{ color: "var(--text)", fontSize: 11 }}>
                {item.name}
              </span>
            </div>
          ))}
        </div>
      )}
    </aside>
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
  const [statusText, setStatusText] = useState("Idle");
  const [runningSummaryCards, setRunningSummaryCards] = useState(false);
  const [runningSemanticEdges, setRunningSemanticEdges] = useState(false);
  const [runningIdeation, setRunningIdeation] = useState(false);
  const [ideation, setIdeation] = useState<IdeationData | null>(null);
  const [ideationOpen, setIdeationOpen] = useState(false);
  const [flowInstance, setFlowInstance] =
    useState<ReactFlowInstance | null>(null);
  const [selected, setSelected] = useState<ResearchPaper | null>(null);
  const [selectedCard, setSelectedCard] = useState<SummaryCardData | null>(null);
  const [summaryCardsByPaperId, setSummaryCardsByPaperId] = useState<
    Record<string, SummaryCardData>
  >({});
  const [semanticEdges, setSemanticEdges] = useState<Edge[]>([]);
  const [edgeViewMode, setEdgeViewMode] = useState<EdgeViewMode>("citation");
  const [runsMenuOpen, setRunsMenuOpen] = useState(false);
  const [availableRuns, setAvailableRuns] = useState<string[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [subtopicsCollapsed, setSubtopicsCollapsed] = useState(false);
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

  const activeEdges =
    edgeViewMode === "semantic" && semanticEdges.length > 0
      ? semanticEdges
      : graph.edges;

  // Unify on smooth bezier curves and solid strokes (old runs may be smoothstep
  // with dashed semantic styles; we strip dashes and avoid animated edge layers).
  const flowEdges = useMemo(
    () =>
      activeEdges.map((edge) => {
        const s = (edge.style ?? {}) as CSSProperties & { strokeDasharray?: string };
        const { strokeDasharray: _d, ...rest } = s;
        return {
          ...edge,
          type: "simplebezier" as const,
          animated: false,
          style: {
            ...rest,
            strokeLinecap: "round" as const,
          },
        };
      }),
    [activeEdges],
  );

  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>();
    // Halos aren't real graph members — skip them so they never appear
    // in the BFS frontier and never get dimmed when a paper is hovered.
    for (const node of graph.nodes) {
      if (node.type === "halo") continue;
      map.set(node.id, new Set());
    }
    for (const edge of flowEdges) {
      map.get(edge.source)?.add(edge.target);
      map.get(edge.target)?.add(edge.source);
    }
    return map;
  }, [flowEdges, graph.nodes]);

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
    if (!connectedIds) return flowEdges;
    return flowEdges.map((edge) => {
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
  }, [flowEdges, connectedIds]);

  const runQuery = async (raw: string) => {
    const nextQuery = raw.trim();
    if (!nextQuery || loading) return;
    setLoading(true);
    setStatusText("Searching arXiv...");
    setError("");
    setSelected(null);
    setSelectedCard(null);
    setSummaryCardsByPaperId({});
    setSemanticEdges([]);
    setEdgeViewMode("citation");
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
      setStatusText("Fetching citations...");

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

      setRunningSummaryCards(true);
      setStatusText("Generating summary cards...");
      const summaryResponse = await fetch("/api/research/summary-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: seedsData.runId, query: nextQuery }),
      });
      const summaryData = (await summaryResponse.json()) as {
        error?: string;
        processed?: number;
      };
      if (!summaryResponse.ok) {
        throw new Error(summaryData.error ?? "Failed to run summary cards");
      }
      setSummaryStatus(`Summary cards complete (${summaryData.processed ?? 0} papers).`);
      await loadSummaryCards(seedsData.runId);
      setRunningSummaryCards(false);

      setRunningSemanticEdges(true);
      setStatusText("Generating custom edges...");
      const semanticResponse = await fetch("/api/research/semantic-edges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: seedsData.runId }),
      });
      const semanticData = (await semanticResponse.json()) as {
        error?: string;
        count?: number;
      };
      if (!semanticResponse.ok) {
        throw new Error(semanticData.error ?? "Failed to generate custom edges");
      }
      const edges = await loadSemanticEdges(seedsData.runId);
      if (edges.length > 0) setEdgeViewMode("semantic");
      setRunningSemanticEdges(false);

      setStatusText("Complete");
    } catch (err) {
      setRunningSummaryCards(false);
      setRunningSemanticEdges(false);
      setError(err instanceof Error ? err.message : "Unexpected error");
      setStatusText("Failed");
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runQuery(query);
  };

  const onExample = (example: string) => {
    setQuery(example);
    void runQuery(example);
  };

  const loadSummaryCards = useCallback(
    async (targetRunId?: string) => {
      const id = targetRunId ?? runId;
      if (!id) return {};
      const cardsResponse = await fetch(
        `/api/research/summary-card?runId=${encodeURIComponent(id)}`,
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
    },
    [runId],
  );

  const loadSemanticEdges = useCallback(
    async (targetRunId?: string) => {
      const id = targetRunId ?? runId;
      if (!id) return [] as Edge[];
      const response = await fetch(
        `/api/research/semantic-edges?runId=${encodeURIComponent(id)}`,
      );
      const data = (await response.json()) as {
        edges?: Edge[];
        error?: string;
      };
      if (!response.ok) throw new Error(data.error ?? "Failed to load semantic edges");
      const edges = data.edges ?? [];
      setSemanticEdges(edges);
      return edges;
    },
    [runId],
  );

  const loadIdeation = useCallback(async () => {
    if (!runId) return null;
    const response = await fetch(`/api/research/ideate?runId=${encodeURIComponent(runId)}`);
    const data = (await response.json()) as IdeationData & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "Failed to load ideation");
    const next = {
      exploredDirections: data.exploredDirections ?? [],
      futureDirections: data.futureDirections ?? [],
    };
    setIdeation(next);
    return next;
  }, [runId]);

  const runIdeate = async () => {
    if (!runId || runningIdeation) return;
    setRunningIdeation(true);
    setError("");
    try {
      const response = await fetch("/api/research/ideate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId }),
      });
      const data = (await response.json()) as IdeationData & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Failed to generate ideation");
      setIdeation({
        exploredDirections: data.exploredDirections ?? [],
        futureDirections: data.futureDirections ?? [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate ideation");
    } finally {
      setRunningIdeation(false);
    }
  };

  const openIdeationModal = async () => {
    if (!runId || phase !== "citations") return;
    setIdeationOpen(true);
    setError("");
    try {
      await loadIdeation();
    } catch (err) {
      setIdeation({ exploredDirections: [], futureDirections: [] });
      setError(err instanceof Error ? err.message : "Failed to load ideation");
    }
  };

  const loadRuns = useCallback(async () => {
    setLoadingRuns(true);
    try {
      const response = await fetch("/api/research/runs", { cache: "no-store" });
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
          { cache: "no-store" },
        );
        const data = (await response.json()) as RunLoadResponse;
        if (!response.ok) throw new Error(data.error ?? "Failed to load run");
        if (!data.graph?.nodes) {
          throw new Error("Saved run is incomplete (missing graph). Try a new search.");
        }
        setRunId(data.runId);
        setActiveQuery(data.query ?? "");
        setQuery(data.query ?? "");
        setGraph(data.graph);
        setPhase("citations");
        setSummaryStatus("");
        setStatusText("Complete");
        setEdgeViewMode("citation");
        void loadSummaryCards(nextRunId);
        void loadSemanticEdges(nextRunId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load run");
      }
    },
  [loadSemanticEdges, loadSummaryCards],
  );

  const showEmptyState = !loading && paperNodeCount === 0;
  const hasSemanticEdges = semanticEdges.length > 0;

  useEffect(() => {
    if (!hasSemanticEdges && edgeViewMode === "semantic") {
      setEdgeViewMode("citation");
    }
  }, [edgeViewMode, hasSemanticEdges]);

  return (
    <main
      className="relative h-screen w-screen overflow-hidden text-[color:var(--text)]"
      style={{ background: "var(--bg)" }}
    >
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
          size={0.9}
          color="rgba(255, 248, 235, 0.055)"
        />
        <Controls showInteractive={false} />
      </ReactFlow>

      <Masthead
        loading={loading}
        phase={phase}
        nodeCount={paperNodeCount}
        edgeCount={activeEdges.length}
        subtopicCount={subtopics.length}
        statusText={statusText}
        statusBusy={loading || runningSummaryCards || runningSemanticEdges}
        onToggleRuns={() => {
          const nextOpen = !runsMenuOpen;
          setRunsMenuOpen(nextOpen);
          if (nextOpen && availableRuns.length === 0) void loadRuns();
        }}
        runsOpen={runsMenuOpen}
        activeQuery={activeQuery}
      />

      {runsMenuOpen && (
        <div
          className="pointer-events-auto scroll-fine absolute left-4 top-14 z-30 max-h-[60vh] w-[340px] overflow-y-auto border p-1 text-[12px]"
          style={{
            background: "var(--bg-elev)",
            borderColor: "var(--line)",
            borderRadius: 4,
          }}
        >
          <div className="label-eyebrow px-3 pb-1.5 pt-2">Previous Runs</div>
          {loadingRuns ? (
            <div className="px-3 py-2" style={{ color: "var(--text-muted)" }}>
              Loading...
            </div>
          ) : availableRuns.length === 0 ? (
            <div className="px-3 py-2" style={{ color: "var(--text-faint)" }}>
              No runs found.
            </div>
          ) : (
            availableRuns.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => void loadExistingRun(item)}
                className="block w-full truncate px-3 py-1.5 text-left transition hover:bg-white/5"
                style={{ color: "var(--text)" }}
                title={item}
              >
                {item}
              </button>
            ))
          )}
        </div>
      )}

      <SubtopicLegend
        subtopics={subtopics}
        graphNodes={graph.nodes}
        hoveredColor={hoveredCluster}
        onHover={setHoveredCluster}
        collapsed={subtopicsCollapsed}
        onToggleCollapsed={() => setSubtopicsCollapsed((v) => !v)}
        showSemanticLegend={edgeViewMode === "semantic"}
      />

      {!showEmptyState && (
        <div className="pointer-events-auto absolute bottom-6 left-5 z-30">
          <button
            type="button"
            onClick={() => void openIdeationModal()}
            disabled={loading || !runId || phase !== "citations"}
            className="inline-flex h-8 items-center gap-1.5 border px-3 text-[11px] uppercase tracking-[0.2em] transition disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              background: "var(--bg-elev)",
              borderColor: "var(--line)",
              color: "var(--accent)",
            }}
          >
            <span
              aria-hidden
              className="inline-block h-1 w-1 rounded-full"
              style={{ background: "var(--accent)" }}
            />
            Ideate
          </button>
        </div>
      )}

      <DetailPanel
        paper={selected}
        card={selectedCard}
        onClose={() => {
          setSelected(null);
          setSelectedCard(null);
        }}
      />

      {showEmptyState && (
        <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center px-6">
          <div className="max-w-[640px] text-center">
            <h1 className="font-serif text-[clamp(2.5rem,8vw,4rem)] font-semibold leading-[1.05] tracking-[-0.02em] text-[color:var(--text)]">
              PaperNet
            </h1>
            <div className="pointer-events-auto mt-10 w-full max-w-xl">
              <p className="topic-bubbles-title mb-4 text-center">Suggested topics</p>
              <div className="mx-auto grid w-full max-w-lg grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3">
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => onExample(example)}
                    className="topic-chip w-full min-h-[48px] rounded-full px-4 py-3 text-center text-[13.5px] leading-snug tracking-[-0.015em]"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <section className="pointer-events-none absolute inset-x-0 bottom-0 z-10 p-5 sm:p-6">
        <form
          onSubmit={onSubmit}
          className="search-shell pointer-events-auto mx-auto flex w-full max-w-2xl min-h-[52px] items-center gap-1.5 pl-4 pr-1.5"
        >
          <span
            className="shrink-0"
            style={{ color: "var(--text-muted)" }}
            aria-hidden
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
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
            placeholder="Search papers and topics…"
            disabled={loading}
            className="min-w-0 flex-1 bg-transparent py-2.5 pl-1 pr-1 text-[14px] leading-tight outline-none placeholder:text-[color:var(--text-faint)] disabled:opacity-60"
            style={{ color: "var(--text)" }}
          />
          {query && !loading && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear query"
              className="shrink-0 rounded-full p-2 transition hover:bg-white/[0.06]"
              style={{ color: "var(--text-faint)" }}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          )}
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full px-5 text-[12px] uppercase tracking-[0.2em] transition disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              background: "var(--accent)",
              color: "#1a1207",
              fontWeight: 600,
            }}
          >
            {loading ? (
              <>
                <span
                  className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2"
                  style={{
                    borderColor: "rgba(26,18,7,0.3)",
                    borderTopColor: "#1a1207",
                  }}
                />
                Mapping
              </>
            ) : (
              "Map"
            )}
          </button>
        </form>

        <div
          className="pointer-events-none mx-auto mt-2.5 flex max-w-2xl items-center justify-between gap-3 px-2 text-[11px] leading-relaxed"
          style={{ color: "var(--text-faint)" }}
        >
          <span className="truncate">
            {error ? (
              <span style={{ color: "var(--danger)" }}>{error}</span>
            ) : showEmptyState ? (
              <span>Pick a topic or search below to build your map.</span>
            ) : (
              <span>Click a paper for details. Scroll to zoom, drag to pan.</span>
            )}
          </span>
          {loading && phase === "idle" && (
            <span className="shrink-0">Fetching · arXiv</span>
          )}
          {loading && phase === "seeds" && (
            <span className="shrink-0">Fetching · Semantic Scholar</span>
          )}
          {!loading && summaryStatus && (
            <span
              className="shrink-0"
              style={{ color: "var(--accent)" }}
            >
              {summaryStatus}
            </span>
          )}
        </div>
      </section>

      {!showEmptyState && (
        <div className="pointer-events-auto absolute bottom-6 right-6 z-30 flex flex-col items-end gap-1">
          {runId && paperNodeCount > 0 && (runningSemanticEdges || hasSemanticEdges) && (
            <div
              className={`px-1 text-[10px] tracking-wide ${runningSemanticEdges ? "animate-pulse" : ""}`}
              style={{
                color: runningSemanticEdges
                  ? "var(--accent)"
                  : "var(--text-faint)",
              }}
            >
              {runningSemanticEdges
                ? "Inferring semantic edges…"
                : "Semantic edges available"}
            </div>
          )}
          <div
            className="flex items-stretch border"
            style={{
              background: "var(--bg-elev)",
              borderColor: "var(--line)",
            }}
          >
            <span
              className="label-eyebrow flex items-center px-3"
              style={{ borderRight: "1px solid var(--line)" }}
            >
              View
            </span>
            <button
              type="button"
              onClick={() => setEdgeViewMode("citation")}
              className="px-3 py-1.5 text-[11px] uppercase tracking-[0.16em] transition"
              style={{
                background:
                  edgeViewMode === "citation" ? "var(--accent)" : "transparent",
                color:
                  edgeViewMode === "citation"
                    ? "#1a1207"
                    : "var(--text-muted)",
                fontWeight: edgeViewMode === "citation" ? 500 : 400,
              }}
            >
              Citation
            </button>
            <button
              type="button"
              onClick={() => hasSemanticEdges && setEdgeViewMode("semantic")}
              disabled={!hasSemanticEdges}
              className="px-3 py-1.5 text-[11px] uppercase tracking-[0.16em] transition disabled:cursor-not-allowed disabled:opacity-40"
              style={{
                background:
                  edgeViewMode === "semantic" ? "var(--accent)" : "transparent",
                color:
                  edgeViewMode === "semantic"
                    ? "#1a1207"
                    : "var(--text-muted)",
                borderLeft: "1px solid var(--line)",
                fontWeight: edgeViewMode === "semantic" ? 500 : 400,
              }}
            >
              Semantic
            </button>
          </div>
        </div>
      )}

      {ideationOpen && (
        <div
          className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center p-6"
          style={{ background: "rgba(8, 9, 11, 0.72)" }}
        >
          <div
            className="scroll-fine max-h-[90vh] w-full max-w-3xl overflow-y-auto border p-8"
            style={{
              background: "var(--bg-elev)",
              borderColor: "var(--line)",
            }}
          >
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <div className="label-eyebrow mb-2">Synthesis</div>
                <h2
                  className="font-serif text-[28px] font-semibold leading-tight tracking-tight"
                  style={{ color: "var(--text)" }}
                >
                  Recurrent themes and prospective directions.
                </h2>
                <p
                  className="mt-2 max-w-prose text-[13px] leading-relaxed"
                  style={{ color: "var(--text-muted)" }}
                >
                  Derived from the summary cards for this run: a concise inventory
                  of established directions, followed by a shorter list of
                  opportunities for further work.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIdeationOpen(false)}
                className="p-1 transition hover:bg-white/5"
                style={{ color: "var(--text-muted)" }}
                aria-label="Close ideation modal"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="mb-7 flex items-center gap-4">
              <button
                type="button"
                onClick={() => void runIdeate()}
                disabled={runningIdeation}
                className="inline-flex h-9 items-center gap-2 px-4 text-[12px] uppercase tracking-[0.18em] transition disabled:cursor-not-allowed disabled:opacity-50"
                style={{
                  background: "var(--accent)",
                  color: "#1a1207",
                  fontWeight: 500,
                }}
              >
                {runningIdeation
                  ? "Running…"
                  : ideation &&
                      (ideation.exploredDirections.length > 0 ||
                        ideation.futureDirections.length > 0)
                    ? "Again"
                    : "Run"}
              </button>
              <span
                className="text-[12px] leading-snug"
                style={{
                  color: "var(--text-faint)",
                }}
              >
                {ideation &&
                (ideation.exploredDirections.length > 0 ||
                  ideation.futureDirections.length > 0)
                  ? "Results from the most recent run appear below."
                  : "This step has not been run for the current search."}
              </span>
            </div>

            <section
              className="mb-7 pt-5"
              style={{ borderTop: "1px solid var(--line)" }}
            >
              <div className="label-eyebrow mb-3">Established directions</div>
              <ol
                className="list-decimal space-y-2.5 pl-5 text-[14px] leading-relaxed"
                style={{ color: "var(--text)" }}
              >
                {ideation?.exploredDirections?.length ? (
                  ideation.exploredDirections.map((item, idx) => (
                    <li key={`explored-${idx}`}>{item}</li>
                  ))
                ) : (
                  <li
                    className="list-none italic"
                    style={{ color: "var(--text-faint)" }}
                  >
                    Run the action above once summary cards have been generated.
                  </li>
                )}
              </ol>
            </section>

            <section
              className="pt-5"
              style={{ borderTop: "1px solid var(--line)" }}
            >
              <div className="label-eyebrow mb-3">Further opportunities</div>
              <ol
                className="list-decimal space-y-2.5 pl-5 text-[14px] leading-relaxed"
                style={{ color: "var(--text)" }}
              >
                {ideation?.futureDirections?.length ? (
                  ideation.futureDirections.map((item, idx) => (
                    <li key={`future-${idx}`}>{item}</li>
                  ))
                ) : (
                  <li
                    className="list-none italic"
                    style={{ color: "var(--text-faint)" }}
                  >
                    No output yet, or the model did not return this section.
                  </li>
                )}
              </ol>
            </section>
          </div>
        </div>
      )}
    </main>
  );
}
