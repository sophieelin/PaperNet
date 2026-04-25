import { fetchArxivPapersByIds } from "@/lib/arxiv";
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

type CitationCandidate = {
  arxivId: string;
  citationCount?: number;
  influentialCitationCount?: number;
};

type CandidateSelection = {
  parentId: string;
  candidates: CitationCandidate[];
};

const score = (paper: CitationCandidate) =>
  (paper.influentialCitationCount ?? 0) * 10 + (paper.citationCount ?? 0);

const toCitationCandidate = (ref: S2Reference["citedPaper"]): CitationCandidate | null => {
  const arxivId = ref?.externalIds?.ArXiv;
  if (!ref?.paperId || !arxivId) return null;
  return {
    arxivId: normalizeArxivId(arxivId),
    citationCount: ref.citationCount,
    influentialCitationCount: ref.influentialCitationCount,
  };
};

const uniqueTopCandidates = (candidates: CitationCandidate[], limit: number) => {
  const seen = new Set<string>();
  return candidates
    .sort((a, b) => score(b) - score(a))
    .filter((candidate) => {
      const arxivId = normalizeArxivId(candidate.arxivId);
      if (seen.has(arxivId)) return false;
      seen.add(arxivId);
      return true;
    })
    .slice(0, limit);
};

const isString = (value: string | undefined): value is string => Boolean(value);

export async function fetchTopCitationsForSeeds(
  seeds: ResearchPaper[],
  perSeed = 3,
): Promise<{
  selections: CitationSelection[];
  dedupedChildren: ResearchPaper[];
}> {
  const seedArxivIds = new Set(
    seeds.map((paper) => paper.arxivId && normalizeArxivId(paper.arxivId)).filter(isString),
  );
  const candidateSelections: CandidateSelection[] = await Promise.all(
    seeds.map(async (seed) => {
      if (!seed.arxivId) return { parentId: seed.id, candidates: [] };
      const arxivId = normalizeArxivId(seed.arxivId);
      const url = `${S2_ENDPOINT}/paper/ARXIV:${encodeURIComponent(arxivId)}/references?fields=${REF_FIELDS}&limit=100`;
      const response = await fetch(url, {
        headers: { "User-Agent": "csail-hack-research-graph/1.0" },
        cache: "no-store",
      });
      if (!response.ok) return { parentId: seed.id, candidates: [] };
      const data = (await response.json()) as { data?: S2Reference[] };
      const candidates = (data.data ?? [])
        .map((entry) => toCitationCandidate(entry.citedPaper))
        .filter((paper): paper is CitationCandidate => Boolean(paper))
        .filter((candidate) => !seedArxivIds.has(normalizeArxivId(candidate.arxivId)));
      return {
        parentId: seed.id,
        candidates: uniqueTopCandidates(candidates, perSeed * 3),
      };
    }),
  );

  const arxivPapers = await fetchArxivPapersByIds(
    candidateSelections.flatMap((selection) =>
      selection.candidates.map((candidate) => candidate.arxivId),
    ),
  );
  const papersByArxivId = new Map(
    arxivPapers.map((paper) => [paper.arxivId ? normalizeArxivId(paper.arxivId) : paper.id, paper]),
  );
  const selections = candidateSelections.map<CitationSelection>((selection) => ({
    parentId: selection.parentId,
    children: selection.candidates
      .flatMap((candidate) => {
        const paper = papersByArxivId.get(normalizeArxivId(candidate.arxivId));
        if (!paper) return [];
        return {
          ...paper,
          citationCount: candidate.citationCount,
          influentialCitationCount: candidate.influentialCitationCount,
        };
      })
      .slice(0, perSeed),
  }));

  const deduped = new Map<string, ResearchPaper>();
  for (const selection of selections) {
    for (const child of selection.children) deduped.set(child.id, child);
  }
  return { selections, dedupedChildren: [...deduped.values()] };
}
