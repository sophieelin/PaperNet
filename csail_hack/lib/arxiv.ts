import { XMLParser } from "fast-xml-parser";
import type { ResearchPaper } from "@/lib/papers";

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
    arxivId: id,
  };
};

export async function searchRecentArxivPapers(
  query: string,
  maxResults = 20,
  daysBack = 365,
): Promise<ResearchPaper[]> {
  const normalizedQuery = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `all:${term}`)
    .join(" AND ");
  const searchQuery = `(${normalizedQuery || `all:${query.trim()}`}) AND submittedDate:${dateRange(daysBack)}`;
  const params = new URLSearchParams({
    search_query: searchQuery,
    start: "0",
    max_results: String(maxResults),
    sortBy: "submittedDate",
    sortOrder: "descending",
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
