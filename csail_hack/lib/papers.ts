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
};

