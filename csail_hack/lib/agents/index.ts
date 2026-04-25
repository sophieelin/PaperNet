import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { runFiguresAgent } from "./figures";
import { runMethodologyAgent } from "./methodology";
import { runSummaryAgent } from "./summary";
import type { AgentInput } from "./types";

const toArxivHtmlUrl = (url: string) =>
  url
    .trim()
    .replace("http://", "https://")
    .replace("https://export.arxiv.org/", "https://arxiv.org/")
    .replace("https://arxiv.org/abs/", "https://arxiv.org/html/")
    .replace(/\.pdf$/i, "")
    .replace("https://arxiv.org/pdf/", "https://arxiv.org/html/");

const toArxivPdfUrl = (url: string) =>
  url
    .trim()
    .replace("http://", "https://")
    .replace("https://export.arxiv.org/", "https://arxiv.org/")
    .replace("https://arxiv.org/html/", "https://arxiv.org/pdf/")
    .replace("https://arxiv.org/abs/", "https://arxiv.org/pdf/")
    .replace(/(?<!\.pdf)$/i, ".pdf");

const safeSlug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);

const dataRoot = () =>
  path.join(
    process.cwd(),
    path.basename(process.cwd()) === "csail_hack" ? "data" : path.join("csail_hack", "data"),
  );

const ensurePromiseWithResolvers = () => {
  const promiseCtor = Promise as typeof Promise & {
    withResolvers?: <T>() => {
      promise: Promise<T>;
      resolve: (value: T | PromiseLike<T>) => void;
      reject: (reason?: unknown) => void;
    };
  };
  if (typeof promiseCtor.withResolvers === "function") return;
  promiseCtor.withResolvers = <T>() => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
};

async function extractPdfTextRobust(pdfBytes: Buffer): Promise<string> {
  const failures: string[] = [];
  try {
    ensurePromiseWithResolvers();
    const { default: PDFParse } = await import("pdf-parse2");
    const parser = new PDFParse();
    const parsed = await parser.loadPDF(pdfBytes);
    const text = parsed?.text?.trim() ?? "";
    if (text) return text;
    failures.push("pdf-parse2 returned empty text");
  } catch (error) {
    failures.push(`pdf-parse2 failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const PDFParser = (await import("pdf2json")).default;
    const text = await new Promise<string>((resolve, reject) => {
      const parser = new PDFParser();
      parser.on("pdfParser_dataError", (errMsg: Error | { parserError: Error }) => {
        if (errMsg instanceof Error) return reject(errMsg);
        return reject(errMsg.parserError ?? new Error("pdf2json parse error"));
      });
      parser.on("pdfParser_dataReady", (pdfData: { Pages?: Array<{ Texts?: Array<{ R?: Array<{ T?: string }> }> }> }) => {
        const pages = (pdfData.Pages ?? []).map((page) =>
          (page.Texts ?? [])
            .flatMap((t) => t.R ?? [])
            .map((r) => decodeURIComponent(r.T ?? ""))
            .join(" ")
            .trim(),
        );
        resolve(pages.filter(Boolean).join("\n\f\n").trim());
      });
      parser.parseBuffer(pdfBytes);
    });
    if (text) return text;
    failures.push("pdf2json returned empty text");
  } catch (error) {
    failures.push(`pdf2json failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  throw new Error(failures.join(" | "));
}

export async function fetchArxivHtmlContent(arxivUrl: string): Promise<string> {
  const response = await fetch(toArxivHtmlUrl(arxivUrl), { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to fetch arXiv HTML (${response.status})`);
  return response.text();
}

async function resolveQueryFolder(query?: string, runId?: string): Promise<string> {
  const root = dataRoot();
  if (runId) return path.join(root, runId);
  const slug = safeSlug(query ?? "");
  if (!slug) return path.join(root, "agent-pdf");

  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const candidates = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${slug}-`))
    .map((entry) => entry.name);
  if (candidates.length === 0) return path.join(root, slug);

  const withTimes = await Promise.all(
    candidates.map(async (name) => {
      const full = path.join(root, name);
      const s = await stat(full);
      return { full, mtimeMs: s.mtimeMs };
    }),
  );
  withTimes.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return withTimes[0].full;
}

async function fetchArxivPdfFallbackContent(arxivUrl: string, query?: string, runId?: string): Promise<string> {
  const pdfUrl = toArxivPdfUrl(arxivUrl);
  const pdfResponse = await fetch(pdfUrl, { cache: "no-store" });
  if (!pdfResponse.ok) throw new Error(`Failed to fetch arXiv PDF (${pdfResponse.status})`);

  const pdfBytes = Buffer.from(await pdfResponse.arrayBuffer());
  const id = safeSlug(arxivUrl.split("/").pop() ?? "paper");
  const queryDir = await resolveQueryFolder(query, runId);
  const outDir = path.join(queryDir, `pdf-${id}-${Date.now()}`);
  await mkdir(outDir, { recursive: true });
  const pdfPath = path.join(outDir, "source.pdf");
  const textPath = path.join(outDir, "text.txt");
  await writeFile(pdfPath, pdfBytes);
  const text = await extractPdfTextRobust(pdfBytes);
  if (!text.trim()) throw new Error(`PDF text extraction failed for ${arxivUrl}`);
  await writeFile(textPath, text, "utf8");
  return readFile(textPath, "utf8");
}

async function fetchArxivContentPreferHtml(arxivUrl: string, query?: string, runId?: string): Promise<string> {
  try {
    return await fetchArxivHtmlContent(arxivUrl);
  } catch {
    return fetchArxivPdfFallbackContent(arxivUrl, query, runId);
  }
}

/**
 * Orchestrator: runs all three agents in parallel and returns one card.
 *
 * Each agent's return type is inferred, so owners can freely evolve their
 * output shape inside their own folder without editing this file.
 */
export async function buildSummaryCard(input: AgentInput) {
  const fullText =
    input.fullText ??
    (input.paper.url ? await fetchArxivContentPreferHtml(input.paper.url, input.query, input.runId) : undefined);
  const enrichedInput = fullText ? { ...input, fullText } : input;
  const [summary, figures, methodology] = await Promise.all([
    runSummaryAgent(enrichedInput),
    runFiguresAgent(enrichedInput),
    runMethodologyAgent(enrichedInput),
  ]);
  return { summary, figures, methodology };
}

export type SummaryCard = Awaited<ReturnType<typeof buildSummaryCard>>;
export type { AgentInput } from "./types";
