import dagre from "dagre";
import type { Edge, Node } from "@xyflow/react";
import type {
  AnyNodeData,
  CitationSelection,
  GraphNodeData,
  ResearchPaper,
  Subtopic,
} from "@/lib/papers";

// Cluster colors. Tuned for a dark background — these are saturated mids
// that read against #0b1220 without bleeding into pure white. Exported so
// alternative clustering sources (e.g. OpenAI) reuse the same palette.
export const SEED_COLORS = [
  "#38bdf8", // sky
  "#34d399", // emerald
  "#fbbf24", // amber
  "#f87171", // red
  "#a78bfa", // violet
  "#f472b6", // pink
  "#2dd4bf", // teal
  "#fb923c", // orange
  "#818cf8", // indigo
  "#a3e635", // lime
  "#22d3ee", // cyan
  "#e879f9", // fuchsia
];

const NEUTRAL_EDGE = "#475569";
const SHARED_COLOR = "#94a3b8";
export const ORPHAN_COLOR = "#64748b";

// Node visual sizes (must match the values used in PaperNode so dagre
// reserves the right amount of space for them).
export const SEED_NODE_SIZE = 132;
export const CITATION_NODE_SIZE = 96;

const makeNode = (
  paper: ResearchPaper,
  position: { x: number; y: number },
  kind: GraphNodeData["kind"],
  color?: string,
): Node<AnyNodeData> => ({
  id: paper.id,
  type: "paper",
  data: { label: paper.title, subtitle: paper.year?.toString(), kind, paper, color },
  position,
});

type LaidOut = {
  nodes: Node<AnyNodeData>[];
  width: number;
  height: number;
};

// Place a cluster of seeds + citations as a circular "topic island":
// 1. Seeds go in the centre — single seed at the centre point, multiple
//    seeds on a small inner ring.
// 2. Citations go on an outer ring, ordered by their primary in-cluster
//    parent's angle so siblings cluster together and most edges become
//    short radial spokes instead of long arcs across the cluster.
// 3. The bounding box is square (diameter × diameter) so meta-tiling
//    can pack circular clusters without leaving rectangular gaps.
//
// Padding (HALO_PADDING) is added to the radius so the halo disc has a
// little breathing room around the citations.
const HALO_PADDING = 36;

const radialClusterLayout = (
  seedNodes: Node<AnyNodeData>[],
  citationNodes: Node<AnyNodeData>[],
  parentIdsByChild: Map<string, string[]>,
): LaidOut => {
  const numSeeds = seedNodes.length;
  const numCites = citationNodes.length;
  if (numSeeds === 0 && numCites === 0) {
    return { nodes: [], width: 0, height: 0 };
  }

  // Inner ring radius — 0 for a single seed (centred), otherwise just
  // big enough that adjacent seeds don't overlap.
  const seedSpacing = SEED_NODE_SIZE + 24;
  const innerRingRadius =
    numSeeds <= 1
      ? 0
      : Math.max(
          SEED_NODE_SIZE * 0.85,
          (seedSpacing * numSeeds) / (2 * Math.PI),
        );

  const seedAngle = new Map<string, number>();
  if (numSeeds === 1) {
    seedAngle.set(seedNodes[0].id, 0);
  } else if (numSeeds > 1) {
    seedNodes.forEach((node, idx) => {
      const angle = (idx / numSeeds) * Math.PI * 2 - Math.PI / 2;
      seedAngle.set(node.id, angle);
    });
  }

  // Sort citations by the angle of their primary (in-cluster) parent so
  // children of the same seed end up next to each other on the ring.
  // Ties break by id for determinism.
  const seedIds = new Set(seedNodes.map((n) => n.id));
  const baseAngleByCite = new Map<string, number>();
  for (const cite of citationNodes) {
    const parents = parentIdsByChild.get(cite.id) ?? [];
    const parent = parents.find((p) => seedIds.has(p));
    baseAngleByCite.set(
      cite.id,
      parent !== undefined ? (seedAngle.get(parent) ?? 0) : 0,
    );
  }
  const sortedCites = [...citationNodes].sort((a, b) => {
    const da = baseAngleByCite.get(a.id) ?? 0;
    const db = baseAngleByCite.get(b.id) ?? 0;
    if (da !== db) return da - db;
    return a.id.localeCompare(b.id);
  });

  // Outer ring(s) — pick a reasonable first ring radius and keep adding
  // concentric rings whenever the previous ring is full. A single huge
  // ring for 25+ citations balloons the cluster diameter; concentric
  // rings keep the overall radius bounded.
  const citationSpacing = CITATION_NODE_SIZE + 26;
  const ringGap = CITATION_NODE_SIZE + 18;
  const baseRingRadius = Math.max(
    innerRingRadius + SEED_NODE_SIZE * 0.6 + 70,
    SEED_NODE_SIZE,
  );
  const ringCapacity = (r: number) =>
    Math.max(2, Math.floor((2 * Math.PI * r) / citationSpacing));

  // Greedily fill rings until every citation has a slot. Each ring is
  // sized just big enough to fit its allocated citations.
  type RingPlacement = { radius: number; count: number };
  const ringPlacements: RingPlacement[] = [];
  let remaining = numCites;
  let nextRadius = baseRingRadius;
  while (remaining > 0 && ringPlacements.length < 6) {
    const capacity = ringCapacity(nextRadius);
    const take = Math.min(capacity, remaining);
    ringPlacements.push({ radius: nextRadius, count: take });
    remaining -= take;
    nextRadius += ringGap;
  }
  // Edge case: if we somehow overshot (capacity miscount), expand last
  // ring rather than dropping nodes.
  if (remaining > 0 && ringPlacements.length > 0) {
    ringPlacements[ringPlacements.length - 1].count += remaining;
    remaining = 0;
  }

  const outerEdgeRadius =
    ringPlacements.length > 0
      ? ringPlacements[ringPlacements.length - 1].radius
      : baseRingRadius;

  const totalRadius =
    (numCites > 0 ? outerEdgeRadius : Math.max(SEED_NODE_SIZE, innerRingRadius + SEED_NODE_SIZE / 2)) +
    CITATION_NODE_SIZE / 2 +
    HALO_PADDING;
  const cx = totalRadius;
  const cy = totalRadius;

  const out: Node<AnyNodeData>[] = [];

  for (const node of seedNodes) {
    const angle = seedAngle.get(node.id) ?? 0;
    const r = innerRingRadius;
    const px = cx + Math.cos(angle) * r - SEED_NODE_SIZE / 2;
    const py = cy + Math.sin(angle) * r - SEED_NODE_SIZE / 2;
    out.push({ ...node, position: { x: px, y: py } });
  }

  // Place the angle-sorted citations across the rings in order so that
  // sibling citations stay angularly adjacent even when split across
  // adjacent rings.
  let cursor = 0;
  ringPlacements.forEach((ring, ringIdx) => {
    const slice = sortedCites.slice(cursor, cursor + ring.count);
    cursor += ring.count;
    // Offset alternating rings by half a slot so concentric citations
    // don't all line up radially (which would create stripes of nodes
    // pointing inward — visually noisy when edges run through them).
    const offset = ringIdx % 2 === 0 ? 0 : Math.PI / Math.max(1, ring.count);
    slice.forEach((node, i) => {
      const angle =
        ring.count === 1
          ? -Math.PI / 2
          : (i / ring.count) * Math.PI * 2 - Math.PI / 2 + offset;
      const px = cx + Math.cos(angle) * ring.radius - CITATION_NODE_SIZE / 2;
      const py = cy + Math.sin(angle) * ring.radius - CITATION_NODE_SIZE / 2;
      out.push({ ...node, position: { x: px, y: py } });
    });
  });

  return {
    nodes: out,
    width: totalRadius * 2,
    height: totalRadius * 2,
  };
};

// A cluster halo is a non-interactive disc rendered behind a cluster's
// nodes so the topic boundary is visible at a glance. The page renders
// it via a custom node type ("halo"). Position / sizing happens here
// because the halo lives in the same coordinate space as the cluster.
const makeHaloNode = (
  bucket: string,
  color: string,
  label: string,
  diameter: number,
): Node<AnyNodeData> => ({
  id: `halo:${bucket}`,
  type: "halo",
  position: { x: 0, y: 0 },
  data: { kind: "halo", color, label, diameter },
  selectable: false,
  draggable: false,
  focusable: false,
  // React Flow renders nodes by array order; placing halos first puts
  // them at the bottom of the DOM stack. zIndex is a belt-and-braces
  // backup in case the consumer reorders the array.
  zIndex: -1,
  // pointer-events:none on the React Flow wrapper means the halo cannot
  // intercept hover/click events — those pass straight through to the
  // paper nodes layered on top.
  style: { pointerEvents: "none" },
});

// Run dagre over a node/edge set with sensible defaults for a citation
// graph. Returns the laid-out nodes plus the bounding box so callers can
// tile multiple sub-graphs side-by-side.
const layoutSubgraph = (
  nodes: Node<AnyNodeData>[],
  edges: Edge[],
): LaidOut => {
  if (nodes.length === 0) return { nodes, width: 0, height: 0 };
  const g = new dagre.graphlib.Graph({ multigraph: false });
  g.setGraph({
    rankdir: "TB",
    nodesep: 50,
    ranksep: 110,
    edgesep: 18,
    marginx: 32,
    marginy: 32,
    ranker: "tight-tree",
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    const size =
      node.data.kind === "seed" ? SEED_NODE_SIZE : CITATION_NODE_SIZE;
    g.setNode(node.id, { width: size, height: size });
  }
  for (const edge of edges) {
    if (g.node(edge.source) && g.node(edge.target)) {
      g.setEdge(edge.source, edge.target);
    }
  }

  dagre.layout(g);
  const graphInfo = g.graph();

  const out = nodes.map((node) => {
    const laid = g.node(node.id);
    if (!laid) return node;
    return {
      ...node,
      position: { x: laid.x - laid.width / 2, y: laid.y - laid.height / 2 },
    };
  });
  return {
    nodes: out,
    width: graphInfo.width ?? 0,
    height: graphInfo.height ?? 0,
  };
};

// Compact "seed on top, citations packed below in a small grid" layout
// for orphan groups. Dagre's TB layout always puts citations in one row,
// which makes a single-seed group much wider than it needs to be. This
// helper instead packs the citations into a square-ish grid so each
// orphan tile takes a sensible amount of horizontal space.
const fanLayout = (
  nodes: Node<AnyNodeData>[],
  seedId: string,
): LaidOut => {
  const seed = nodes.find((n) => n.id === seedId);
  const children = nodes.filter((n) => n.id !== seedId);
  if (!seed) return layoutSubgraph(nodes, []);

  const seedSize = SEED_NODE_SIZE;
  const childSize = CITATION_NODE_SIZE;
  const childGap = 32;

  const cols = Math.min(3, Math.max(2, Math.ceil(Math.sqrt(children.length))));
  const rowCount = Math.ceil(children.length / cols);
  const rowWidth = cols * childSize + (cols - 1) * childGap;
  const totalWidth = Math.max(seedSize, rowWidth);
  const totalHeight = seedSize + 90 + rowCount * childSize + (rowCount - 1) * childGap;

  const out: Node<AnyNodeData>[] = [];
  out.push({
    ...seed,
    position: { x: (totalWidth - seedSize) / 2, y: 0 },
  });
  const childrenStartY = seedSize + 90;
  const xStart = (totalWidth - rowWidth) / 2;
  children.forEach((child, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    out.push({
      ...child,
      position: {
        x: xStart + col * (childSize + childGap),
        y: childrenStartY + row * (childSize + childGap),
      },
    });
  });
  return { nodes: out, width: totalWidth, height: totalHeight };
};

// Tile sub-layouts in a roughly-square grid. This is what gives the user
// "clusters that read as clusters spatially" — each subtopic gets its
// own visual region instead of being scrambled across one giant layer.
// Tile sub-layouts in a roughly-square grid. With circular clusters of
// varying diameter, the simple "max column width / max row height" grid
// would leave a lot of whitespace. We sort groups largest-first so the
// big anchor cluster ends up in the top-left and adjacent cells share
// closer to their natural size; the small clusters fill in around it.
const tileSubgraphs = (
  groups: LaidOut[],
  gap = 36,
): Node<AnyNodeData>[] => {
  if (groups.length === 0) return [];
  if (groups.length === 1) return groups[0].nodes;

  const sorted = [...groups].sort((a, b) => b.width * b.height - a.width * a.height);

  const cols = Math.max(1, Math.ceil(Math.sqrt(sorted.length)));
  const colWidths: number[] = new Array(cols).fill(0);
  const rowHeights: number[] = [];

  sorted.forEach((group, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    if (rowHeights.length <= row) rowHeights.push(0);
    if (group.width > colWidths[col]) colWidths[col] = group.width;
    if (group.height > rowHeights[row]) rowHeights[row] = group.height;
  });

  const colXOffsets = colWidths.map((_, i) =>
    colWidths.slice(0, i).reduce((sum, w) => sum + w + gap, 0),
  );
  const rowYOffsets = rowHeights.map((_, i) =>
    rowHeights.slice(0, i).reduce((sum, h) => sum + h + gap, 0),
  );

  const out: Node<AnyNodeData>[] = [];
  sorted.forEach((group, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const dx = colXOffsets[col] + (colWidths[col] - group.width) / 2;
    const dy = rowYOffsets[row] + (rowHeights[row] - group.height) / 2;
    for (const node of group.nodes) {
      out.push({
        ...node,
        position: { x: node.position.x + dx, y: node.position.y + dy },
      });
    }
  });
  return out;
};

// Lay out N nodes in a roughly-square grid. Used by the seed-only phase
// where we have no edges to feed dagre.
const gridLayout = (
  nodes: Node<AnyNodeData>[],
  gap = 60,
): Node<AnyNodeData>[] => {
  if (nodes.length === 0) return nodes;
  const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  return nodes.map((node, idx) => {
    const isSeed = node.data.kind === "seed";
    const size = isSeed ? SEED_NODE_SIZE : CITATION_NODE_SIZE;
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    return {
      ...node,
      position: {
        x: col * (size + gap),
        y: row * (size + gap),
      },
    };
  });
};

export function buildSeedGraph(seeds: ResearchPaper[]): {
  nodes: Node<AnyNodeData>[];
  edges: Edge[];
  subtopics: Subtopic[];
} {
  // Phase 1 has no citation data yet, so each seed gets its own palette
  // entry just so they read as distinct. Real cluster colors land in
  // phase 2 (buildCitationGraph).
  const placeholderNodes = seeds.map((paper, index) =>
    makeNode(paper, { x: 0, y: 0 }, "seed", SEED_COLORS[index % SEED_COLORS.length]),
  );
  return { nodes: gridLayout(placeholderNodes), edges: [], subtopics: [] };
}

class UnionFind {
  private parent = new Map<string, string>();
  private size = new Map<string, number>();

  constructor(items: Iterable<string>) {
    for (const item of items) {
      this.parent.set(item, item);
      this.size.set(item, 1);
    }
  }

  find(x: string): string {
    let cur = this.parent.get(x) ?? x;
    while (cur !== this.parent.get(cur)) cur = this.parent.get(cur) ?? cur;
    this.parent.set(x, cur);
    return cur;
  }

  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    const sa = this.size.get(ra) ?? 1;
    const sb = this.size.get(rb) ?? 1;
    this.parent.set(ra, rb);
    this.size.set(rb, sa + sb);
  }

  componentSize(x: string): number {
    return this.size.get(this.find(x)) ?? 1;
  }
}

// Generic English / paper-scaffolding noise. Notably we *don't* strip
// topical tokens like "graph", "neural", "diffusion", "retrieval" — those
// need to be available so phrases like "graph construction" or "diffusion
// model" can even form. Distinctiveness is enforced later by a corpus-
// frequency cap.
const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "of", "for", "with", "in", "on", "to",
  "via", "by", "using", "from", "as", "at", "is", "are", "be", "this",
  "that", "these", "those", "into", "between", "across", "over", "under",
  "their", "its", "it", "we", "our", "approach", "approaches", "novel",
  "new", "based", "towards", "toward", "study", "analysis", "applications",
  "application", "framework", "frameworks", "method", "methods",
  "improving", "improved", "improvement", "evaluation", "evaluate",
  "evaluating", "system", "systems", "task", "tasks", "training", "train",
  "trained", "result", "results", "performance", "fine", "tuning", "tuned",
  "scale", "large", "small", "general", "specific", "high", "low", "best",
  "robust", "efficient", "fast", "slow", "scalable", "free", "first",
  "second", "single", "multiple",
]);

const tokenize = (text: string) =>
  text.toLowerCase().match(/[a-z][a-z0-9-]+/g) ?? [];

const meaningfulTokens = (title: string) =>
  tokenize(title).filter((t) => !STOP_WORDS.has(t) && t.length >= 3);

const phrasesFor = (title: string): Set<string> => {
  const tokens = meaningfulTokens(title);
  const out = new Set<string>();
  for (let i = 0; i < tokens.length; i += 1) {
    out.add(tokens[i]);
    if (i + 1 < tokens.length) out.add(`${tokens[i]} ${tokens[i + 1]}`);
    if (i + 2 < tokens.length)
      out.add(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
  }
  return out;
};

const titleCase = (phrase: string) =>
  phrase
    .split(" ")
    .map((w) => (w.length <= 2 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");

const isQuerySubsumed = (phrase: string, queryTokenSet: Set<string>) => {
  if (queryTokenSet.size === 0) return false;
  const tokens = phrase.split(" ");
  return tokens.every((t) => queryTokenSet.has(t));
};

// Picks the phrase that best describes a cluster, using a TF-IDF-style
// score: frequent in the cluster, rare in the surrounding corpus. We look
// at both the cluster's seed titles *and* its cited papers' titles —
// citations are usually canonical works whose names ("denoising
// diffusion", "score-based generative") are far more telling than a
// one-off seed title.
const labelForCluster = (
  clusterSeedTitles: string[],
  clusterCitationTitles: string[],
  corpusTitles: string[],
  queryTokenSet: Set<string>,
): string => {
  if (clusterSeedTitles.length === 0) return "Mixed";

  const corpusCount = new Map<string, number>();
  for (const title of corpusTitles) {
    for (const phrase of phrasesFor(title)) {
      corpusCount.set(phrase, (corpusCount.get(phrase) ?? 0) + 1);
    }
  }
  const corpusSize = corpusTitles.length;
  const corpusCap = Math.max(2, Math.ceil(corpusSize * 0.5));

  const clusterScore = new Map<string, number>();
  const bumpCluster = (title: string, weight: number) => {
    for (const phrase of phrasesFor(title)) {
      clusterScore.set(phrase, (clusterScore.get(phrase) ?? 0) + weight);
    }
  };
  for (const t of clusterSeedTitles) bumpCluster(t, 1);
  for (const t of clusterCitationTitles) bumpCluster(t, 0.7);

  const ranked = [...clusterScore.entries()]
    .filter(([phrase, score]) => {
      if (score < 1.5) return false;
      if (isQuerySubsumed(phrase, queryTokenSet)) return false;
      const corpus = corpusCount.get(phrase) ?? 0;
      return corpus <= corpusCap;
    })
    .map(([phrase, score]) => {
      const corpus = corpusCount.get(phrase) ?? 0.5;
      const idf = Math.log((corpusSize + 1) / (corpus + 0.5));
      const tokens = phrase.split(" ");
      const lengthBonus = tokens.length === 1 ? 0.6 : 1 + tokens.length * 0.7;
      const queryOverlap = tokens.filter((t) => queryTokenSet.has(t)).length;
      const noveltyBonus = 1 - 0.5 * (queryOverlap / tokens.length);
      return { phrase, score: score * idf * lengthBonus * noveltyBonus };
    })
    .sort((a, b) => b.score - a.score);

  if (ranked[0]) return titleCase(ranked[0].phrase);

  const fallback = [
    ...new Set(
      [...clusterSeedTitles, ...clusterCitationTitles].flatMap((t) => [
        ...phrasesFor(t),
      ]),
    ),
  ]
    .filter((phrase) => phrase.includes(" ") && !isQuerySubsumed(phrase, queryTokenSet))
    .map((phrase) => ({
      phrase,
      score: phrase.split(" ").length /
        Math.max(1, corpusCount.get(phrase) ?? 1),
    }))
    .sort((a, b) => b.score - a.score)[0]?.phrase;
  return fallback ? titleCase(fallback) : "Related";
};

// Result shape produced by any clustering source (heuristic or LLM).
// `clusterIdxByChild` is optional: when present, the layout will bucket
// each citation by its *own* topic instead of inheriting its parent's
// bucket — that's what gives the user "every paper sits under exactly
// one topic, visually too."
export type ClusterInfo = {
  colorBySeed: Map<string, string>;
  colorByChild: Map<string, string>;
  clusterIdxBySeed: Map<string, number>;
  clusterIdxByChild?: Map<string, number>;
  subtopics: Subtopic[];
};

export const clusterByCitations = (
  seeds: ResearchPaper[],
  parentIdsByChild: Map<string, string[]>,
  dedupedChildren: ResearchPaper[],
  query?: string,
): ClusterInfo => {
  const uf = new UnionFind(seeds.map((s) => s.id));

  const queryTokenSet = new Set(query ? meaningfulTokens(query) : []);

  // We score every *pair* of seeds by accumulating evidence from two
  // signals, then union pairs in descending score order with a
  // cluster-size cap. The size cap is what prevents the historic "one
  // giant blob" failure: even if a chain of weak evidence connects every
  // seed transitively, the cap stops the chain once a cluster is big
  // enough to be useful as a category.
  const totalSeeds = seeds.length;
  const citationCap = Math.max(2, Math.ceil(totalSeeds * 0.4));
  const phraseCap = Math.max(2, Math.ceil(totalSeeds * 0.35));

  const pairKey = (a: string, b: string) => (a < b ? `${a}\u0001${b}` : `${b}\u0001${a}`);
  const pairScore = new Map<string, { a: string; b: string; score: number }>();
  const bumpPair = (a: string, b: string, weight: number) => {
    if (a === b) return;
    const key = pairKey(a, b);
    const existing = pairScore.get(key);
    if (existing) existing.score += weight;
    else pairScore.set(key, { a, b, score: weight });
  };

  // Signal 1 — bibliographic coupling.
  // For every distinctive citation, every pair of seeds that both cite
  // it gets a rarity-weighted bump. Rare overlaps are stronger evidence
  // of shared niche than common ones.
  for (const parents of parentIdsByChild.values()) {
    if (parents.length < 2 || parents.length > citationCap) continue;
    const rarityWeight = parents.length === 2 ? 1.5 : 1;
    for (let i = 0; i < parents.length; i += 1) {
      for (let j = i + 1; j < parents.length; j += 1) {
        bumpPair(parents[i], parents[j], rarityWeight);
      }
    }
  }

  // Signal 2 — shared distinctive multi-word title phrases (excluding
  // the query). 2-3 word phrases that appear in 2 to ~35% of titles
  // count, weighted by rarity.
  const phraseToSeeds = new Map<string, string[]>();
  for (const seed of seeds) {
    for (const phrase of phrasesFor(seed.title)) {
      if (!phrase.includes(" ")) continue;
      if (isQuerySubsumed(phrase, queryTokenSet)) continue;
      const list = phraseToSeeds.get(phrase) ?? [];
      list.push(seed.id);
      phraseToSeeds.set(phrase, list);
    }
  }
  for (const seedIds of phraseToSeeds.values()) {
    if (seedIds.length < 2 || seedIds.length > phraseCap) continue;
    const rarityWeight =
      seedIds.length === 2 ? 2 : seedIds.length === 3 ? 1.5 : 1;
    for (let i = 0; i < seedIds.length; i += 1) {
      for (let j = i + 1; j < seedIds.length; j += 1) {
        bumpPair(seedIds[i], seedIds[j], rarityWeight);
      }
    }
  }

  // Permissive threshold (1.5) lets pairs with one strong piece of
  // evidence — a rarity-2 phrase, or a shared rare citation + any title
  // overlap — merge. The size cap below is what prevents this from
  // turning into a single blob.
  const MERGE_THRESHOLD = 1.5;
  const MAX_CLUSTER_SIZE = Math.max(4, Math.ceil(totalSeeds * 0.45));

  // Process pairs strongest-first. This guarantees that the highest-
  // confidence merges happen before we run out of cap budget, so weak
  // chain merges can't displace a tight clique.
  const pairs = [...pairScore.values()]
    .filter((p) => p.score >= MERGE_THRESHOLD)
    .sort((a, b) => b.score - a.score);
  for (const { a, b } of pairs) {
    if (uf.find(a) === uf.find(b)) continue;
    const merged = uf.componentSize(a) + uf.componentSize(b);
    if (merged > MAX_CLUSTER_SIZE) continue;
    uf.union(a, b);
  }

  const rootBySeed = new Map<string, string>();
  for (const seed of seeds) rootBySeed.set(seed.id, uf.find(seed.id));

  const seedsByRoot = new Map<string, ResearchPaper[]>();
  for (const seed of seeds) {
    const root = rootBySeed.get(seed.id)!;
    const list = seedsByRoot.get(root) ?? [];
    list.push(seed);
    seedsByRoot.set(root, list);
  }

  const childById = new Map(dedupedChildren.map((c) => [c.id, c]));
  const citationTitlesBySeed = new Map<string, string[]>();
  for (const [childId, parents] of parentIdsByChild) {
    const child = childById.get(childId);
    if (!child?.title) continue;
    for (const parent of parents) {
      const list = citationTitlesBySeed.get(parent) ?? [];
      list.push(child.title);
      citationTitlesBySeed.set(parent, list);
    }
  }

  // Only multi-seed clusters earn a palette color. Largest cluster gets
  // the first (most saturated) palette entry so the eye lands there
  // first.
  const namedRoots = [...seedsByRoot.entries()]
    .filter(([, members]) => members.length > 1)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([root]) => root);

  const allSeedTitles = seeds.map((s) => s.title);
  const allCitationTitles = dedupedChildren
    .map((c) => c.title)
    .filter((t): t is string => Boolean(t));
  const corpusTitles = [...allSeedTitles, ...allCitationTitles];

  const colorByRoot = new Map<string, string>();
  const idxByRoot = new Map<string, number>();
  const subtopics: Subtopic[] = [];
  namedRoots.forEach((root, idx) => {
    const color = SEED_COLORS[idx % SEED_COLORS.length];
    colorByRoot.set(root, color);
    idxByRoot.set(root, idx);
    const members = seedsByRoot.get(root)!;
    const memberCitationTitles = members.flatMap(
      (m) => citationTitlesBySeed.get(m.id) ?? [],
    );
    subtopics.push({
      color,
      label: labelForCluster(
        members.map((m) => m.title),
        memberCitationTitles,
        corpusTitles,
        queryTokenSet,
      ),
      seedIds: members.map((m) => m.id),
    });
  });

  const colorBySeed = new Map<string, string>();
  const clusterIdxBySeed = new Map<string, number>();
  for (const [seedId, root] of rootBySeed) {
    colorBySeed.set(seedId, colorByRoot.get(root) ?? ORPHAN_COLOR);
    clusterIdxBySeed.set(seedId, idxByRoot.get(root) ?? Number.MAX_SAFE_INTEGER);
  }

  const colorByChild = new Map<string, string>();
  for (const child of dedupedChildren) {
    const parents = parentIdsByChild.get(child.id) ?? [];
    const namedParentRoots = new Set(
      parents
        .map((p) => rootBySeed.get(p))
        .filter((root): root is string => typeof root === "string" && colorByRoot.has(root)),
    );
    if (namedParentRoots.size === 1) {
      const onlyRoot = [...namedParentRoots][0];
      colorByChild.set(child.id, colorByRoot.get(onlyRoot)!);
    } else if (namedParentRoots.size > 1) {
      colorByChild.set(child.id, SHARED_COLOR);
    }
  }

  return { colorBySeed, colorByChild, clusterIdxBySeed, subtopics };
};

export function buildCitationGraph(
  seeds: ResearchPaper[],
  selections: CitationSelection[],
  dedupedChildren: ResearchPaper[],
  query?: string,
  precomputed?: ClusterInfo,
): {
  nodes: Node<AnyNodeData>[];
  edges: Edge[];
  subtopics: Subtopic[];
} {
  const parentIdsByChild = new Map<string, string[]>();
  for (const selection of selections) {
    for (const child of selection.children) {
      parentIdsByChild.set(child.id, [
        ...(parentIdsByChild.get(child.id) ?? []),
        selection.parentId,
      ]);
    }
  }

  const cluster =
    precomputed ??
    clusterByCitations(seeds, parentIdsByChild, dedupedChildren, query);
  const {
    colorBySeed,
    colorByChild,
    clusterIdxBySeed,
    clusterIdxByChild,
    subtopics,
  } = cluster;

  const seedNodes = seeds.map((paper) =>
    makeNode(paper, { x: 0, y: 0 }, "seed", colorBySeed.get(paper.id)),
  );
  const childNodes = dedupedChildren.map((paper) =>
    makeNode(paper, { x: 0, y: 0 }, "citation", colorByChild.get(paper.id)),
  );
  const nodeById = new Map<string, Node<AnyNodeData>>();
  for (const node of [...seedNodes, ...childNodes]) nodeById.set(node.id, node);

  // Edges within a cluster are drawn brighter — they're the meaningful
  // "this seed cites that paper" structure inside a topic. Edges that
  // span clusters get drawn faintly because there are O(N²) of them and
  // they otherwise dominate the canvas with crossing lines.
  const edges = selections.flatMap((selection) => {
    const parentIdx = clusterIdxBySeed.get(selection.parentId);
    const color = colorBySeed.get(selection.parentId) ?? NEUTRAL_EDGE;
    return selection.children.map((child) => {
      const childIdx =
        clusterIdxByChild?.get(child.id) ??
        // Heuristic clusterer doesn't track per-citation index — assume
        // same-cluster when the child's color matches the parent's.
        (colorByChild.get(child.id) === color ? parentIdx : undefined);
      const sameCluster =
        parentIdx !== undefined &&
        childIdx !== undefined &&
        parentIdx === childIdx;
      return {
        id: `e:${selection.parentId}->${child.id}`,
        source: selection.parentId,
        target: child.id,
        type: "simplebezier" as const,
        animated: false,
        style: {
          stroke: sameCluster ? color : NEUTRAL_EDGE,
          strokeWidth: sameCluster ? 1.6 : 0.8,
          opacity: sameCluster ? 0.9 : 0.22,
          strokeLinecap: "round" as const,
        },
        markerEnd: {
          type: "arrowclosed" as const,
          color: sameCluster ? color : NEUTRAL_EDGE,
          width: sameCluster ? 14 : 10,
          height: sameCluster ? 14 : 10,
        },
      };
    });
  });

  // Group seeds by their cluster index so each subtopic becomes its own
  // sub-layout. Orphan seeds (those not in any named subtopic) become a
  // single "Other" group at the end. Citations belong to whichever
  // cluster owns the majority of their parent seeds; if it's a tie or
  // they're cited across multiple clusters, they go to the most-common
  // parent's cluster (deterministic by parent order).
  // Group seed IDs by bucket. Each named cluster is its own bucket;
  // orphan seeds (no named subtopic) each get their own bucket so they
  // tile as compact one-seed-with-its-citations cells instead of one
  // ugly wide row.
  type Bucket = string; // "c:<idx>" for clusters, "o:<seedId>" for orphans
  const seedToBucket = new Map<string, Bucket>();
  const bucketToSeedIds = new Map<Bucket, string[]>();
  for (const seed of seeds) {
    const idx = clusterIdxBySeed.get(seed.id) ?? Number.MAX_SAFE_INTEGER;
    const bucket: Bucket =
      idx === Number.MAX_SAFE_INTEGER ? `o:${seed.id}` : `c:${idx}`;
    seedToBucket.set(seed.id, bucket);
    const list = bucketToSeedIds.get(bucket) ?? [];
    list.push(seed.id);
    bucketToSeedIds.set(bucket, list);
  }

  // Citations belong to a bucket. If the clustering source assigned each
  // citation directly to a topic (e.g. OpenAI per-paper assignment), use
  // that — every paper then lives in the visual region of its own topic.
  // Otherwise fall back to "majority of parent seeds' bucket", which is
  // what the heuristic clusterer expects.
  const childToBucket = new Map<string, Bucket>();
  for (const child of dedupedChildren) {
    const childIdx = clusterIdxByChild?.get(child.id);
    if (childIdx !== undefined && childIdx !== Number.MAX_SAFE_INTEGER) {
      childToBucket.set(child.id, `c:${childIdx}`);
      continue;
    }
    const parents = parentIdsByChild.get(child.id) ?? [];
    if (parents.length === 0) {
      childToBucket.set(child.id, `o:${child.id}`);
      continue;
    }
    const counts = new Map<Bucket, number>();
    for (const parent of parents) {
      const bucket = seedToBucket.get(parent);
      if (!bucket) continue;
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    }
    let best: Bucket = seedToBucket.get(parents[0]) ?? `o:${parents[0]}`;
    let bestCount = -1;
    for (const [bucket, count] of counts) {
      if (count > bestCount) {
        bestCount = count;
        best = bucket;
      }
    }
    childToBucket.set(child.id, best);
  }

  // Citations may live in a bucket that has no seeds (rare but possible
  // when a topic is composed entirely of references). Make sure those
  // buckets appear in the ordering so their nodes get laid out.
  for (const bucket of childToBucket.values()) {
    if (!bucketToSeedIds.has(bucket)) bucketToSeedIds.set(bucket, []);
  }

  // Order: named clusters (lowest idx first — that mirrors the LLM /
  // heuristic priority order) then orphans (in seed order).
  const namedBuckets = [...bucketToSeedIds.keys()]
    .filter((b) => b.startsWith("c:"))
    .sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
  const orphanBuckets = [...bucketToSeedIds.keys()].filter((b) =>
    b.startsWith("o:"),
  );
  const orderedBuckets: Bucket[] = [...namedBuckets, ...orphanBuckets];

  // Lay out each cluster as a circular "topic island" — seeds at the
  // centre, citations on a ring sorted by parent angle. For named
  // clusters we also stamp a translucent halo disc behind the cluster
  // so the topic boundary is obvious even before reading the legend.
  const groups: LaidOut[] = orderedBuckets.map((bucket) => {
    const seedIds = bucketToSeedIds.get(bucket) ?? [];
    const childIds = [...childToBucket.entries()]
      .filter(([, b]) => b === bucket)
      .map(([childId]) => childId);
    const groupSeedNodes = seedIds
      .map((id) => nodeById.get(id))
      .filter((n): n is Node<AnyNodeData> => Boolean(n));
    const groupCitationNodes = childIds
      .map((id) => nodeById.get(id))
      .filter((n): n is Node<AnyNodeData> => Boolean(n));

    const laid = radialClusterLayout(
      groupSeedNodes,
      groupCitationNodes,
      parentIdsByChild,
    );

    if (bucket.startsWith("c:")) {
      const idx = Number(bucket.slice(2));
      const subtopic = subtopics[idx];
      if (subtopic) {
        const halo = makeHaloNode(
          bucket,
          subtopic.color,
          subtopic.label,
          laid.width,
        );
        // Halo first → renders behind the paper nodes in the same group.
        laid.nodes = [halo, ...laid.nodes];
      }
    }

    return laid;
  });

  const allNodes = tileSubgraphs(groups, 56);

  return { nodes: allNodes, edges, subtopics };
}
