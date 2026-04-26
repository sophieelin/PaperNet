import { fetchAcmPapersByDois } from "@/lib/acm";
import { fetchArxivPapersByIds } from "@/lib/arxiv";
import type { CitationSelection, ResearchPaper } from "@/lib/papers";
import {
  refineSearchQueryForPaperSearch,
  shouldRefineSearchByPaperCount,
} from "@/lib/refineSearchQuery";

const S2_ENDPOINT = "https://api.semanticscholar.org/graph/v1";
const S2_UNAUTHENTICATED_DELAY_MS = 1200;
const S2_AUTHENTICATED_DELAY_MS = 150;
const S2_MAX_RETRIES = 3;
const SEARCH_CACHE_TTL_MS = 30 * 60 * 1000;
const SEARCH_FIELDS =
  "paperId,title,abstract,year,url,citationCount,influentialCitationCount,authors,externalIds,openAccessPdf,publicationDate,venue,publicationTypes";
const REF_FIELDS = SEARCH_FIELDS;

const normalizeArxivId = (id: string) => id.replace(/v\d+$/i, "");

type S2Paper = {
  paperId?: string;
  title?: string;
  abstract?: string;
  year?: number;
  url?: string;
  citationCount?: number;
  influentialCitationCount?: number;
  authors?: Array<{ name?: string }>;
  externalIds?: { ArXiv?: string; DOI?: string; CorpusId?: number | string };
  openAccessPdf?: { url?: string; status?: string } | null;
  publicationDate?: string;
  venue?: string;
  publicationTypes?: string[];
};

type S2SearchResponse = {
  data?: S2Paper[];
};

type S2Reference = {
  citedPaper?: S2Paper;
};

type CitationCandidate = {
  paper: ResearchPaper;
  citationCount?: number;
  influentialCitationCount?: number;
};

type CandidateSelection = {
  parentId: string;
  candidates: CitationCandidate[];
};

let s2Queue = Promise.resolve();
let lastS2RequestAt = 0;
const searchCache = new Map<string, { expiresAt: number; papers: ResearchPaper[] }>();
const inFlightSearches = new Map<string, Promise<ResearchPaper[]>>();

const headers = () => ({
  "User-Agent": "csail-hack-research-graph/1.0",
  ...(process.env.SEMANTIC_SCHOLAR_API_KEY
    ? { "x-api-key": process.env.SEMANTIC_SCHOLAR_API_KEY }
    : {}),
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const retryAfterMs = (response: Response) => {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : undefined;
};

const throttleSemanticScholar = async () => {
  const minDelay = process.env.SEMANTIC_SCHOLAR_API_KEY
    ? S2_AUTHENTICATED_DELAY_MS
    : S2_UNAUTHENTICATED_DELAY_MS;
  const waitMs = Math.max(0, lastS2RequestAt + minDelay - Date.now());
  if (waitMs > 0) await sleep(waitMs);
  lastS2RequestAt = Date.now();
};

const fetchSemanticScholar = async (url: string): Promise<Response> => {
  const request = s2Queue.then(async (): Promise<Response> => {
    for (let attempt = 0; attempt <= S2_MAX_RETRIES; attempt += 1) {
      await throttleSemanticScholar();
      const response = await fetch(url, {
        headers: headers(),
        cache: "no-store",
      });
      if (response.status !== 429) return response;
      if (attempt === S2_MAX_RETRIES) return response;
      await sleep(retryAfterMs(response) ?? 1500 * 2 ** attempt);
    }
    throw new Error("Semantic Scholar request loop exited unexpectedly.");
  });
  s2Queue = request.then(() => undefined, () => undefined);
  return request;
};

const semanticScholarError = (response: Response, action: string) => {
  if (response.status === 429) {
    return new Error(
      `Semantic Scholar rate limit hit while ${action}. Wait a bit and retry, or set SEMANTIC_SCHOLAR_API_KEY for a higher rate limit.`,
    );
  }
  return new Error(`Semantic Scholar ${action} failed: ${response.status}`);
};

const normalizeDoi = (doi: string) =>
  doi.trim().replace(/^https?:\/\/doi\.org\//i, "").replace(/^doi:/i, "").toLowerCase();

const isAcmDoi = (doi?: string) => Boolean(doi && normalizeDoi(doi).startsWith("10.1145/"));

const acmArticleUrl = (doi: string) => `https://dl.acm.org/doi/${normalizeDoi(doi)}`;

const acmHtmlUrl = (doi: string) => `https://dl.acm.org/doi/fullHtml/${normalizeDoi(doi)}`;

const acmPdfUrl = (doi: string) => `https://dl.acm.org/doi/pdf/${normalizeDoi(doi)}`;

const toSupportedPaper = (paper: S2Paper): ResearchPaper | null => {
  if (!paper.paperId || !paper.title) return null;
  const arxivId = paper.externalIds?.ArXiv
    ? normalizeArxivId(paper.externalIds.ArXiv)
    : undefined;
  const doi = paper.externalIds?.DOI ? normalizeDoi(paper.externalIds.DOI) : undefined;
  const authors = (paper.authors ?? []).map((author) => author.name?.trim()).filter(Boolean) as string[];

  if (arxivId) {
    return {
      id: `arxiv:${arxivId}`,
      source: "arxiv",
      title: paper.title,
      summary: paper.abstract,
      authors,
      year: paper.year,
      published: paper.publicationDate,
      url: `https://arxiv.org/abs/${arxivId}`,
      htmlUrl: `https://arxiv.org/html/${arxivId}`,
      pdfUrl: paper.openAccessPdf?.url ?? `https://arxiv.org/pdf/${arxivId}.pdf`,
      arxivId,
      doi,
      s2PaperId: paper.paperId,
      citationCount: paper.citationCount,
      influentialCitationCount: paper.influentialCitationCount,
    };
  }

  if (doi && isAcmDoi(doi)) {
    return {
      id: `acm:${doi}`,
      source: "acm",
      title: paper.title,
      summary: paper.abstract,
      authors,
      year: paper.year,
      published: paper.publicationDate,
      url: acmArticleUrl(doi),
      htmlUrl: acmHtmlUrl(doi),
      pdfUrl: paper.openAccessPdf?.url ?? acmPdfUrl(doi),
      doi,
      s2PaperId: paper.paperId,
      citationCount: paper.citationCount,
      influentialCitationCount: paper.influentialCitationCount,
    };
  }

  return null;
};

const impactScore = (paper: CitationCandidate) =>
  (paper.influentialCitationCount ?? 0) * 10 + (paper.citationCount ?? 0);

const toCitationCandidate = (paper?: S2Paper): CitationCandidate | null => {
  if (!paper) return null;
  const supported = toSupportedPaper(paper);
  if (!supported) return null;
  return {
    paper: supported,
    citationCount: paper.citationCount,
    influentialCitationCount: paper.influentialCitationCount,
  };
};

const uniqueTopCandidates = (candidates: CitationCandidate[], limit: number) => {
  const seen = new Set<string>();
  return candidates
    .sort((a, b) => impactScore(b) - impactScore(a))
    .filter((candidate) => {
      if (seen.has(candidate.paper.id)) return false;
      seen.add(candidate.paper.id);
      return true;
    })
    .slice(0, limit);
};

const toS2LookupId = (paper: ResearchPaper) => {
  if (paper.s2PaperId) return paper.s2PaperId;
  if (paper.arxivId) return `ARXIV:${normalizeArxivId(paper.arxivId)}`;
  if (paper.doi) return `DOI:${normalizeDoi(paper.doi)}`;
};

const hydrateCandidates = async (candidates: CitationCandidate[]) => {
  const arxivIds = candidates
    .map((candidate) => candidate.paper.arxivId)
    .filter((id): id is string => Boolean(id));
  const acmDois = candidates
    .map((candidate) => candidate.paper.doi)
    .filter((doi): doi is string => Boolean(doi && isAcmDoi(doi)));
  const [arxivPapers, acmPapers] = await Promise.all([
    fetchArxivPapersByIds(arxivIds).catch(() => []),
    fetchAcmPapersByDois(acmDois).catch(() => []),
  ]);
  const hydrated = new Map<string, ResearchPaper>();
  for (const paper of arxivPapers) hydrated.set(paper.id, paper);
  for (const paper of acmPapers) hydrated.set(paper.id, paper);

  return candidates.flatMap((candidate) => {
    const hydratedPaper = hydrated.get(candidate.paper.id);
    const paper = hydratedPaper?.title ? hydratedPaper : candidate.paper;
    if (!paper.title) return [];
    return {
      ...paper,
      s2PaperId: candidate.paper.s2PaperId ?? paper.s2PaperId,
      citationCount: candidate.citationCount ?? paper.citationCount,
      influentialCitationCount:
        candidate.influentialCitationCount ?? paper.influentialCitationCount,
    };
  });
};

export async function searchSupportedPapers(
  query: string,
  maxResults = 20,
): Promise<ResearchPaper[]> {
  const normalizedQuery = query.trim().toLowerCase().replace(/\s+/g, " ");
  const cacheKey = `${normalizedQuery}:${maxResults}`;
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.papers;

  const inFlight = inFlightSearches.get(cacheKey);
  if (inFlight) return inFlight;

  const runSemanticSearch = async (searchText: string) => {
    const p = new URLSearchParams({
      query: searchText,
      limit: String(Math.min(100, Math.max(maxResults * 4, maxResults))),
      fields: SEARCH_FIELDS,
    });
    const response = await fetchSemanticScholar(`${S2_ENDPOINT}/paper/search?${p.toString()}`);
    if (!response.ok) throw semanticScholarError(response, "searching papers");

    const data = (await response.json()) as S2SearchResponse;
    const deduped = new Map<string, ResearchPaper>();
    for (const paper of data.data ?? []) {
      const supported = toSupportedPaper(paper);
      if (!supported) continue;
      deduped.set(supported.id, supported);
      if (deduped.size >= maxResults) break;
    }
    return [...deduped.values()];
  };

  const search = (async () => {
    let papers = await runSemanticSearch(query);
    if (shouldRefineSearchByPaperCount(papers.length) && process.env.OPENAI_API_KEY) {
      const refined = await refineSearchQueryForPaperSearch(query);
      if (refined) papers = await runSemanticSearch(refined);
    }
    if (papers.length) {
      searchCache.set(cacheKey, { expiresAt: Date.now() + SEARCH_CACHE_TTL_MS, papers });
    }
    return papers;
  })();

  inFlightSearches.set(cacheKey, search);
  try {
    return await search;
  } finally {
    inFlightSearches.delete(cacheKey);
  }
}

export async function fetchTopCitationsForSeeds(
  seeds: ResearchPaper[],
  perSeed = 3,
): Promise<{
  selections: CitationSelection[];
  dedupedChildren: ResearchPaper[];
}> {
  const seedIds = new Set(seeds.map((paper) => paper.id));
  const candidateSelections: CandidateSelection[] = [];
  for (const seed of seeds) {
    const lookupId = toS2LookupId(seed);
    if (!lookupId) {
      candidateSelections.push({ parentId: seed.id, candidates: [] });
      continue;
    }
    const params = new URLSearchParams({
      fields: REF_FIELDS,
      limit: "100",
    });
    const response = await fetchSemanticScholar(
      `${S2_ENDPOINT}/paper/${encodeURIComponent(lookupId)}/references?${params.toString()}`,
    );
    if (!response.ok) {
      candidateSelections.push({ parentId: seed.id, candidates: [] });
      continue;
    }
    const data = (await response.json()) as { data?: S2Reference[] };
    const candidates = (data.data ?? [])
      .map((entry) => toCitationCandidate(entry.citedPaper))
      .filter((candidate): candidate is CitationCandidate => Boolean(candidate))
      .filter((candidate) => !seedIds.has(candidate.paper.id));
    candidateSelections.push({
      parentId: seed.id,
      candidates: uniqueTopCandidates(candidates, perSeed * 3),
    });
  }

  const allCandidates = uniqueTopCandidates(
    candidateSelections.flatMap((selection) => selection.candidates),
    seeds.length * perSeed * 3,
  );
  const hydratedCandidates = await hydrateCandidates(allCandidates);
  const hydratedById = new Map(hydratedCandidates.map((paper) => [paper.id, paper]));

  const selections = candidateSelections.map<CitationSelection>((selection) => ({
    parentId: selection.parentId,
    children: selection.candidates
      .flatMap((candidate) => hydratedById.get(candidate.paper.id) ?? [])
      .slice(0, perSeed),
  }));

  const deduped = new Map<string, ResearchPaper>();
  for (const selection of selections) {
    for (const child of selection.children) deduped.set(child.id, child);
  }
  return { selections, dedupedChildren: [...deduped.values()] };
}
