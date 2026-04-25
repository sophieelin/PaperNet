import type { Edge, Node } from "@xyflow/react";
import type { CitationSelection, GraphNodeData, ResearchPaper } from "@/lib/papers";

const SEED_COLUMNS = 5;
const SEED_X_GAP = 360;
const SEED_Y_GAP = 300;
const SEED_TOP_Y = -520;
const OCCUPANCY_CELL = 180;

const hashCode = (value: string) =>
  [...value].reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) >>> 0, 7);

const keyFor = (x: number, y: number, cell: number) =>
  `${Math.round(x / cell)}:${Math.round(y / cell)}`;

const occupy = (occupied: Set<string>, point: { x: number; y: number }, cell: number) =>
  occupied.add(keyFor(point.x, point.y, cell));

const isFree = (occupied: Set<string>, point: { x: number; y: number }, cell: number) =>
  !occupied.has(keyFor(point.x, point.y, cell));

const nearestFreePoint = (
  desired: { x: number; y: number },
  occupied: Set<string>,
  cell = OCCUPANCY_CELL,
  maxRing = 36,
) => {
  if (isFree(occupied, desired, cell)) return desired;
  const baseX = Math.round(desired.x / cell);
  const baseY = Math.round(desired.y / cell);
  for (let ring = 1; ring <= maxRing; ring += 1) {
    for (let dx = -ring; dx <= ring; dx += 1) {
      for (let dy = -ring; dy <= ring; dy += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const point = { x: (baseX + dx) * cell, y: (baseY + dy) * cell };
        if (isFree(occupied, point, cell)) return point;
      }
    }
  }
  return { x: desired.x + cell, y: desired.y + cell };
};

const makeNode = (
  paper: ResearchPaper,
  position: { x: number; y: number },
  kind: GraphNodeData["kind"],
): Node<GraphNodeData> => ({
  id: paper.id,
  data: { label: paper.title, subtitle: paper.year?.toString(), kind },
  position,
  style: {
    width: 84,
    height: 84,
    borderRadius: "999px",
    border: kind === "seed" ? "1px solid #111" : "1px solid #64748b",
    background: kind === "seed" ? "#ffffff" : "#f8fafc",
    color: "#111",
    fontSize: 10,
    display: "grid",
    placeItems: "center",
    textAlign: "center",
    padding: 8,
  },
});

const seedGridPosition = (index: number, total: number) => {
  const columns = Math.min(SEED_COLUMNS, Math.max(1, Math.ceil(Math.sqrt(total))));
  const row = Math.floor(index / columns);
  const col = index % columns;
  const width = (columns - 1) * SEED_X_GAP;
  const x = col * SEED_X_GAP - width / 2;
  const y = SEED_TOP_Y + row * SEED_Y_GAP;
  return { x, y };
};

export function buildSeedGraph(seeds: ResearchPaper[]): {
  nodes: Node<GraphNodeData>[];
  edges: Edge[];
} {
  const positions = new Map<string, { x: number; y: number }>();
  const occupied = new Set<string>();
  for (const [index, paper] of seeds.entries()) {
    const desired = seedGridPosition(index, seeds.length);
    const placed = nearestFreePoint(desired, occupied);
    positions.set(paper.id, placed);
    occupy(occupied, placed, OCCUPANCY_CELL);
  }
  return {
    nodes: seeds.map((paper) => makeNode(paper, positions.get(paper.id) ?? { x: 0, y: 0 }, "seed")),
    edges: [],
  };
}

export function buildCitationGraph(
  seeds: ResearchPaper[],
  selections: CitationSelection[],
  dedupedChildren: ResearchPaper[],
): {
  nodes: Node<GraphNodeData>[];
  edges: Edge[];
} {
  const seedGraph = buildSeedGraph(seeds);
  const seedNodesById = new Map(seedGraph.nodes.map((node) => [node.id, node]));
  const occupied = new Set<string>();
  for (const seedNode of seedGraph.nodes) occupy(occupied, seedNode.position, OCCUPANCY_CELL);
  const parentIdsByChild = new Map<string, string[]>();
  for (const selection of selections) {
    for (const child of selection.children) {
      parentIdsByChild.set(child.id, [...(parentIdsByChild.get(child.id) ?? []), selection.parentId]);
    }
  }

  const maxSeedY = seedGraph.nodes.reduce((max, node) => Math.max(max, node.position.y), SEED_TOP_Y);
  const firstChildLayerY = maxSeedY + 360;
  const laneOffsets = [-480, -240, 0, 240, 480];
  const laneCounts = new Map<string, number>();
  const childPositions = new Map<string, { x: number; y: number }>();

  for (const child of dedupedChildren) {
    const parentIds = parentIdsByChild.get(child.id) ?? [];
    const anchors = parentIds
      .map((id) => seedNodesById.get(id)?.position)
      .filter(Boolean) as Array<{ x: number; y: number }>;
    const anchorX =
      anchors.length > 0
        ? anchors.reduce((sum, point) => sum + point.x, 0) / anchors.length
        : 0;
    const laneIndex = Math.abs(hashCode(child.id)) % laneOffsets.length;
    const tier = Math.abs(hashCode(`${child.id}:tier`)) % 3;
    const laneKey = `${tier}:${laneIndex}:${Math.round(anchorX / 120)}`;
    const laneCount = laneCounts.get(laneKey) ?? 0;
    laneCounts.set(laneKey, laneCount + 1);
    const rowInTier = Math.floor(laneCount / 4);
    const colInLane = laneCount % 4;
    const laneShift = (colInLane - 1.5) * 170;
    const desired = {
      x: anchorX + laneOffsets[laneIndex] + laneShift,
      y: firstChildLayerY + tier * 320 + rowInTier * 220,
    };
    const placed = nearestFreePoint(desired, occupied);
    childPositions.set(child.id, placed);
    occupy(occupied, placed, OCCUPANCY_CELL);
  }

  const childNodes = dedupedChildren.map((paper) =>
    makeNode(paper, childPositions.get(paper.id) ?? { x: 0, y: 0 }, "citation"),
  );

  const edges = selections.flatMap((selection) =>
    selection.children.map((child) => ({
      id: `e:${selection.parentId}->${child.id}`,
      source: selection.parentId,
      target: child.id,
      type: "smoothstep" as const,
      animated: false,
      style: { stroke: "#94a3b8", strokeWidth: 1 },
    })),
  );

  return { nodes: [...seedGraph.nodes, ...childNodes], edges };
}

