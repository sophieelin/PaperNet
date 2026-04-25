export type PaperSource = "arxiv" | "semantic-scholar";

export type ResearchPaper = {
  id: string;
  source: PaperSource;
  title: string;
  summary?: string;
  authors: string[];
  year?: number;
  published?: string;
  url?: string;
  arxivId?: string;
  citationCount?: number;
  influentialCitationCount?: number;
};

export type CitationSelection = {
  parentId: string;
  children: ResearchPaper[];
};

export type GraphNodeData = {
  label: string;
  subtitle?: string;
  kind: "seed" | "citation";
  paper: ResearchPaper;
  color?: string;
};

// Halo nodes are non-interactive translucent discs rendered behind each
// cluster so the topic boundary is visible at a glance. They share the
// React Flow nodes array with paper nodes but use their own React
// component, keyed off `data.kind === "halo"`.
export type HaloNodeData = {
  kind: "halo";
  color: string;
  label: string;
  diameter: number;
};

export type AnyNodeData = GraphNodeData | HaloNodeData;

export type Subtopic = {
  color: string;
  label: string;
  seedIds: string[];
};

