import { XMLParser } from "fast-xml-parser";
import type { ResearchPaper } from "@/lib/papers";
import {
  refineSearchQueryForPaperSearch,
  shouldRefineSearchByPaperCount,
} from "@/lib/refineSearchQuery";

const ARXIV_ENDPOINT = "https://export.arxiv.org/api/query";
const parser = new XMLParser({ ignoreAttributes: false });

type ArxivEntry = {
  id?: string;
  title?: string;
  summary?: string;
  published?: string;
  author?: { name?: string } | Array<{ name?: string }>;
  link?: Array<{ "@_href"?: string; "@_type"?: string; "@_rel"?: string }>;
};

const toArray = <T>(value: T | T[] | undefined): T[] =>
  value ? (Array.isArray(value) ? value : [value]) : [];

const dateRange = (daysBack: number) => {
  const end = new Date();
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - daysBack);
  const format = (d: Date) =>
    `${d.getUTCFullYear()}${`${d.getUTCMonth() + 1}`.padStart(2, "0")}${`${d.getUTCDate()}`.padStart(2, "0")}${`${d.getUTCHours()}`.padStart(2, "0")}${`${d.getUTCMinutes()}`.padStart(2, "0")}`;
  return `[${format(start)} TO ${format(end)}]`;
};

const extractArxivId = (id = "") => id.split("/abs/")[1]?.trim();

const toResearchPaper = (entry: ArxivEntry): ResearchPaper | null => {
  const authors = toArray(entry.author).map((a) => a.name?.trim()).filter(Boolean) as string[];
  const id = extractArxivId(entry.id);
  if (!id || !entry.title) return null;
  const url = toArray(entry.link).find((l) => l["@_rel"] === "alternate")?.["@_href"] ?? entry.id;
  return {
    id: `arxiv:${id}`,
    source: "arxiv",
    title: entry.title.replace(/\s+/g, " ").trim(),
    summary: entry.summary?.replace(/\s+/g, " ").trim(),
    authors,
    published: entry.published,
    year: entry.published ? Number(entry.published.slice(0, 4)) : undefined,
    url,
    htmlUrl: `https://arxiv.org/html/${id}/`,
    pdfUrl: `https://arxiv.org/pdf/${id}.pdf`,
    arxivId: id,
  };
};

// arXiv silently returns 0 results when an `all:` clause hits a stop word
// like "the" or "for", so we filter those before building the AND query.
// Anything ≤2 chars is also dropped (numeric versions, single letters).
const QUERY_STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "for", "with", "in", "on", "to",
  "via", "by", "from", "as", "at", "is", "are", "be", "this", "that",
  "into", "between", "across", "over", "under", "vs", "versus",
]);

const buildSearchClauses = (query: string): { strict: string; relaxed: string } => {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  const meaningful = tokens.filter(
    (t) => t.length > 2 && !QUERY_STOPWORDS.has(t.toLowerCase()),
  );
  // Strict: every meaningful token must appear (good precision when the user
  // gives 2+ specific words).
  const strict =
    meaningful.length > 0
      ? meaningful.map((t) => `all:${t}`).join(" AND ")
      : `all:${query.trim()}`;
  // Relaxed: any meaningful token may appear (fallback when the strict query
  // is too narrow and arXiv returns nothing).
  const relaxed =
    meaningful.length > 1
      ? `(${meaningful.map((t) => `all:${t}`).join(" OR ")})`
      : strict;
  return { strict, relaxed };
};

const fetchArxiv = async (searchQuery: string, maxResults: number): Promise<ResearchPaper[]> => {
  const params = new URLSearchParams({
    search_query: searchQuery,
    start: "0",
    max_results: String(maxResults),
    sortBy: "submittedDate",
    sortOrder: "descending",
  });
  const url = `${ARXIV_ENDPOINT}?${params.toString()}`;
  // arXiv occasionally returns 5xx or empty bodies under load. One short retry
  // keeps the dev experience smooth without masking real failures.
  const fetchOnce = () =>
    fetch(url, {
      headers: { "User-Agent": "csail-hack-research-graph/1.0" },
      cache: "no-store",
    });
  let response = await fetchOnce();
  if (!response.ok && response.status >= 500) {
    await new Promise((r) => setTimeout(r, 500));
    response = await fetchOnce();
  }
  if (!response.ok) throw new Error(`arXiv request failed: ${response.status}`);

  const xml = await response.text();
  const parsed = parser.parse(xml) as { feed?: { entry?: ArxivEntry | ArxivEntry[] } };
  return toArray(parsed.feed?.entry).reduce<ResearchPaper[]>((papers, entry) => {
    const paper = toResearchPaper(entry);
    if (paper) papers.push(paper);
    return papers;
  }, []);
};

async function searchRecentArxivPapersWithQuery(
  query: string,
  maxResults: number,
  daysBack: number,
  allowRefineWithOpenAI: boolean,
): Promise<ResearchPaper[]> {
  const { strict, relaxed } = buildSearchClauses(query);
  const dateClause = `AND submittedDate:${dateRange(daysBack)}`;

  // Try strict first (high precision). If no recent matches, relax to OR.
  // If still empty, drop the date window so the user always gets *something*
  // back to render rather than a silent empty graph.
  const attempts = [
    `(${strict}) ${dateClause}`,
    `(${relaxed}) ${dateClause}`,
    `(${relaxed})`,
  ];
  let papers: ResearchPaper[] = [];
  for (const searchQuery of attempts) {
    const batch = await fetchArxiv(searchQuery, maxResults);
    if (batch.length > 0) {
      papers = batch;
      break;
    }
  }

  if (!allowRefineWithOpenAI) return papers;
  if (!shouldRefineSearchByPaperCount(papers.length)) return papers;
  if (!process.env.OPENAI_API_KEY) return papers;
  const refined = await refineSearchQueryForPaperSearch(query);
  if (!refined) return papers;
  return searchRecentArxivPapersWithQuery(refined, maxResults, daysBack, false);
}

/**
 * Searches arXiv’s API for recent papers. If the first pass yields fewer than
 * five results, a single OpenAI call may condense the query, then a second
 * search runs (no further refinement after that).
 */
export async function searchRecentArxivPapers(
  query: string,
  maxResults = 20,
  daysBack = 365,
): Promise<ResearchPaper[]> {
  return searchRecentArxivPapersWithQuery(query, maxResults, daysBack, true);
}

export async function fetchArxivPapersByIds(ids: string[]): Promise<ResearchPaper[]> {
  const uniqueIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (uniqueIds.length === 0) return [];

  const params = new URLSearchParams({
    id_list: uniqueIds.join(","),
    max_results: String(uniqueIds.length),
  });

  const response = await fetch(`${ARXIV_ENDPOINT}?${params.toString()}`, {
    headers: { "User-Agent": "csail-hack-research-graph/1.0" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`arXiv request failed: ${response.status}`);

  const xml = await response.text();
  const parsed = parser.parse(xml) as { feed?: { entry?: ArxivEntry | ArxivEntry[] } };
  return toArray(parsed.feed?.entry).reduce<ResearchPaper[]>((papers, entry) => {
    const paper = toResearchPaper(entry);
    if (paper) papers.push(paper);
    return papers;
  }, []);
}
