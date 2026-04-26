import type { ResearchPaper } from "@/lib/papers";

const ACM_ENDPOINT = "https://dl.acm.org/action/doSearch";
const CROSSREF_ENDPOINT = "https://api.crossref.org/works";
const ACM_SEARCH_TIMEOUT_MS = 3500;

const decodeHtml = (value: string) =>
  value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

const stripTags = (html: string) =>
  decodeHtml(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());

const normalizeDoi = (doi: string) =>
  decodeURIComponent(doi)
    .trim()
    .replace(/^https?:\/\/doi\.org\//i, "")
    .replace(/^doi:/i, "")
    .toLowerCase();

const acmArticleUrl = (doi: string) => `https://dl.acm.org/doi/${normalizeDoi(doi)}`;

const acmHtmlUrl = (doi: string) => `https://dl.acm.org/doi/fullHtml/${normalizeDoi(doi)}`;

const acmPdfUrl = (doi: string) => `https://dl.acm.org/doi/pdf/${normalizeDoi(doi)}`;

async function fetchWithTimeout(url: string, timeoutMs: number, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

type CrossrefAuthor = {
  given?: string;
  family?: string;
};

type CrossrefWork = {
  DOI?: string;
  title?: string[];
  abstract?: string;
  author?: CrossrefAuthor[];
  issued?: { "date-parts"?: number[][] };
  "published-print"?: { "date-parts"?: number[][] };
  "published-online"?: { "date-parts"?: number[][] };
  URL?: string;
  "is-referenced-by-count"?: number;
};

type CrossrefResponse = {
  message?: {
    items?: CrossrefWork[];
  };
};

const yearFromDateParts = (work: CrossrefWork) =>
  work.issued?.["date-parts"]?.[0]?.[0] ??
  work["published-online"]?.["date-parts"]?.[0]?.[0] ??
  work["published-print"]?.["date-parts"]?.[0]?.[0];

const crossrefAuthors = (authors?: CrossrefAuthor[]) =>
  (authors ?? [])
    .map((author) => [author.given, author.family].filter(Boolean).join(" ").trim())
    .filter(Boolean);

const fromDoi = (doi: string, fields: Partial<ResearchPaper> = {}): ResearchPaper => {
  const normalized = normalizeDoi(doi);
  return {
    id: `acm:${normalized}`,
    source: "acm",
    title: fields.title ?? "",
    summary: fields.summary,
    authors: fields.authors ?? [],
    year: fields.year,
    published: fields.published,
    url: acmArticleUrl(normalized),
    htmlUrl: acmHtmlUrl(normalized),
    pdfUrl: acmPdfUrl(normalized),
    doi: normalized,
    citationCount: fields.citationCount,
  };
};

async function searchAcmDigitalLibrary(
  query: string,
  maxResults = 20,
): Promise<ResearchPaper[]> {
  const params = new URLSearchParams({
    AllField: query,
    pageSize: String(Math.min(50, Math.max(1, maxResults))),
  });
  const response = await fetchWithTimeout(`${ACM_ENDPOINT}?${params.toString()}`, ACM_SEARCH_TIMEOUT_MS, {
    headers: { "User-Agent": "csail-hack-research-graph/1.0" },
    cache: "no-store",
  });
  if (!response.ok) return [];

  const html = await response.text();
  const links = [
    ...html.matchAll(
      /<a\b[^>]*href=["']\/doi\/(?:abs\/|fullHtml\/|pdf\/)?(10\.1145\/[^"?#']+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi,
    ),
  ];
  const papers = new Map<string, ResearchPaper>();
  for (const [, rawDoi, rawTitle] of links) {
    const doi = normalizeDoi(rawDoi);
    const title = stripTags(rawTitle);
    if (!doi || !title || title.length < 8 || papers.has(doi)) continue;
    papers.set(doi, fromDoi(doi, {
      title,
    }));
    if (papers.size >= maxResults) break;
  }

  return [...papers.values()];
}

async function searchAcmViaCrossref(
  query: string,
  maxResults = 20,
): Promise<ResearchPaper[]> {
  const params = new URLSearchParams({
    query,
    rows: String(Math.min(50, Math.max(1, maxResults))),
    filter: "prefix:10.1145",
    select: "DOI,title,author,abstract,issued,published-print,published-online,URL,is-referenced-by-count",
  });
  const response = await fetch(`${CROSSREF_ENDPOINT}?${params.toString()}`, {
    headers: {
      "User-Agent": "csail-hack-research-graph/1.0 (mailto:research-graph@example.com)",
    },
    cache: "no-store",
  });
  if (!response.ok) return [];

  const data = (await response.json()) as CrossrefResponse;
  const papers = new Map<string, ResearchPaper>();
  for (const item of data.message?.items ?? []) {
    if (!item.DOI || !item.title?.[0]) continue;
    const doi = normalizeDoi(item.DOI);
    if (!doi.startsWith("10.1145/") || papers.has(doi)) continue;
    papers.set(doi, fromDoi(doi, {
      title: stripTags(item.title[0]),
      summary: item.abstract ? stripTags(item.abstract) : undefined,
      authors: crossrefAuthors(item.author),
      year: yearFromDateParts(item),
      url: item.URL,
      citationCount: item["is-referenced-by-count"],
    }));
    if (papers.size >= maxResults) break;
  }
  return [...papers.values()];
}

export async function fetchAcmPapersByDois(dois: string[]): Promise<ResearchPaper[]> {
  const uniqueDois = [...new Set(dois.map((doi) => normalizeDoi(doi)).filter(Boolean))];
  if (uniqueDois.length === 0) return [];

  const params = new URLSearchParams({
    filter: uniqueDois.map((doi) => `doi:${doi}`).join(","),
    rows: String(uniqueDois.length),
    select: "DOI,title,author,abstract,issued,published-print,published-online,URL,is-referenced-by-count",
  });
  const response = await fetch(`${CROSSREF_ENDPOINT}?${params.toString()}`, {
    headers: {
      "User-Agent": "csail-hack-research-graph/1.0 (mailto:research-graph@example.com)",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    return uniqueDois.map((doi) => fromDoi(doi));
  }

  const data = (await response.json()) as CrossrefResponse;
  const byDoi = new Map<string, ResearchPaper>();
  for (const item of data.message?.items ?? []) {
    if (!item.DOI || !item.title?.[0]) continue;
    const doi = normalizeDoi(item.DOI);
    if (!uniqueDois.includes(doi)) continue;
    byDoi.set(doi, fromDoi(doi, {
      title: stripTags(item.title[0]),
      summary: item.abstract ? stripTags(item.abstract) : undefined,
      authors: crossrefAuthors(item.author),
      year: yearFromDateParts(item),
      url: item.URL,
      citationCount: item["is-referenced-by-count"],
    }));
  }

  return uniqueDois.map((doi) => byDoi.get(doi) ?? fromDoi(doi));
}

export async function searchAcmPapers(
  query: string,
  maxResults = 20,
): Promise<ResearchPaper[]> {
  const [dlResults, crossrefResults] = await Promise.all([
    searchAcmDigitalLibrary(query, maxResults).catch(() => []),
    searchAcmViaCrossref(query, maxResults).catch(() => []),
  ]);
  const papers = new Map<string, ResearchPaper>();
  for (const paper of [...dlResults, ...crossrefResults]) {
    papers.set(paper.id, paper);
    if (papers.size >= maxResults) break;
  }
  return [...papers.values()];
}
