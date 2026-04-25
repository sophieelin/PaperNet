import type { CitationSelection, ResearchPaper } from "@/lib/papers";

const S2_ENDPOINT = "https://api.semanticscholar.org/graph/v1";
const REF_FIELDS =
  "paperId,title,year,url,citationCount,influentialCitationCount,authors,externalIds";

const normalizeArxivId = (id: string) => id.replace(/v\d+$/i, "");

type S2Reference = {
  citedPaper?: {
    paperId?: string;
    title?: string;
    year?: number;
    url?: string;
    citationCount?: number;
    influentialCitationCount?: number;
    authors?: Array<{ name?: string }>;
    externalIds?: { ArXiv?: string };
  };
};

const score = (paper: ResearchPaper) =>
  (paper.influentialCitationCount ?? 0) * 10 + (paper.citationCount ?? 0);

const toS2Paper = (ref: S2Reference["citedPaper"]): ResearchPaper | null => {
  if (!ref?.paperId || !ref.title) return null;
  return {
    id: `s2:${ref.paperId}`,
    source: "semantic-scholar",
    title: ref.title,
    authors: (ref.authors ?? []).map((a) => a.name?.trim()).filter(Boolean) as string[],
    year: ref.year,
    url: ref.url,
    citationCount: ref.citationCount,
    influentialCitationCount: ref.influentialCitationCount,
    arxivId: ref.externalIds?.ArXiv,
  };
};

export async function fetchTopCitationsForSeeds(
  seeds: ResearchPaper[],
  perSeed = 3,
): Promise<{
  selections: CitationSelection[];
  dedupedChildren: ResearchPaper[];
}> {
  const selections = await Promise.all(
    seeds.map(async (seed) => {
      if (!seed.arxivId) return { parentId: seed.id, children: [] };
      const arxivId = normalizeArxivId(seed.arxivId);
      const url = `${S2_ENDPOINT}/paper/ARXIV:${encodeURIComponent(arxivId)}/references?fields=${REF_FIELDS}&limit=100`;
      const response = await fetch(url, {
        headers: { "User-Agent": "csail-hack-research-graph/1.0" },
        cache: "no-store",
      });
      if (!response.ok) return { parentId: seed.id, children: [] };
      const data = (await response.json()) as { data?: S2Reference[] };
      const children = (data.data ?? [])
        .map((entry) => toS2Paper(entry.citedPaper))
        .filter((paper): paper is ResearchPaper => Boolean(paper))
        .sort((a, b) => score(b) - score(a))
        .slice(0, perSeed);
      return { parentId: seed.id, children };
    }),
  );

  const deduped = new Map<string, ResearchPaper>();
  for (const selection of selections) {
    for (const child of selection.children) deduped.set(child.id, child);
  }
  return { selections, dedupedChildren: [...deduped.values()] };
}

