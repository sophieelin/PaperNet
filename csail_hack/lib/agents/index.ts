import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
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

const normalizeDoi = (doi: string) =>
  doi.trim().replace(/^https?:\/\/doi\.org\//i, "").replace(/^doi:/i, "").toLowerCase();

const toAcmHtmlUrl = (doi: string) => `https://dl.acm.org/doi/fullHtml/${normalizeDoi(doi)}`;

const ACM_CONTENT_TIMEOUT_MS = 4500;
const ARXIV_CONTENT_TIMEOUT_MS = 12000;

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
const execFileAsync = promisify(execFile);

const safeDecodePdfTextToken = (value = "") => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

async function extractPdfTextViaOcr(pdfPath: string, outDir: string): Promise<string> {
  const ocrTextPath = path.join(outDir, "ocr-text.txt");
  const py = `
import os, sys, tempfile, subprocess
import fitz

pdf_path, out_txt = sys.argv[1], sys.argv[2]
doc = fitz.open(pdf_path)
chunks = []
for i, page in enumerate(doc):
    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        img_path = tmp.name
    pix.save(img_path)
    try:
        r = subprocess.run(["tesseract", img_path, "stdout", "-l", "eng", "--psm", "6"], capture_output=True, text=True)
        if r.returncode == 0 and r.stdout:
            chunks.append(r.stdout.strip())
    finally:
        try:
            os.remove(img_path)
        except OSError:
            pass

text = "\\n\\f\\n".join([c for c in chunks if c])
with open(out_txt, "w", encoding="utf-8") as f:
    f.write(text)
print(str(len(text)))
`;
  await execFileAsync("python3", ["-c", py, pdfPath, ocrTextPath], { maxBuffer: 20 * 1024 * 1024 });
  return readFile(ocrTextPath, "utf8");
}

async function extractPdfTextRobust(pdfBytes: Buffer, pdfPath: string, outDir: string): Promise<string> {
  const failures: string[] = [];

  try {
    const PDFParser = (await import("pdf2json")).default;
    const text = await new Promise<string>((resolve, reject) => {
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => {
        const first = String(args[0] ?? "");
        if (
          first.startsWith("Warning: Unsupported: field.type of Link") ||
          first.startsWith("Warning: NOT valid form element")
        ) {
          return;
        }
        originalWarn(...args);
      };
      const parser = new PDFParser();
      parser.on("pdfParser_dataError", (errMsg: Error | { parserError: Error }) => {
        console.warn = originalWarn;
        if (errMsg instanceof Error) return reject(errMsg);
        return reject(errMsg.parserError ?? new Error("pdf2json parse error"));
      });
      parser.on("pdfParser_dataReady", (pdfData: { Pages?: Array<{ Texts?: Array<{ R?: Array<{ T?: string }> }> }> }) => {
        console.warn = originalWarn;
        const pages = (pdfData.Pages ?? []).map((page) =>
          (page.Texts ?? [])
            .flatMap((t) => t.R ?? [])
            .map((r) => safeDecodePdfTextToken(r.T ?? ""))
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

  try {
    const ocrText = (await extractPdfTextViaOcr(pdfPath, outDir)).trim();
    if (ocrText) return ocrText;
    failures.push("OCR returned empty text");
  } catch (error) {
    failures.push(`OCR failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  throw new Error(failures.join(" | "));
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: { "User-Agent": "csail-hack-research-graph/1.0" },
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchHtmlContent(htmlUrl: string, timeoutMs = ARXIV_CONTENT_TIMEOUT_MS): Promise<string> {
  const response = await fetchWithTimeout(htmlUrl, timeoutMs);
  if (!response.ok) throw new Error(`Failed to fetch HTML (${response.status})`);
  return response.text();
}

export async function fetchArxivHtmlContent(arxivUrl: string): Promise<string> {
  return fetchHtmlContent(toArxivHtmlUrl(arxivUrl));
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

async function fetchPdfFallbackContent(
  pdfUrl: string,
  paperId: string,
  query?: string,
  runId?: string,
): Promise<string> {
  const pdfResponse = await fetchWithTimeout(pdfUrl, ARXIV_CONTENT_TIMEOUT_MS);
  if (!pdfResponse.ok) throw new Error(`Failed to fetch PDF (${pdfResponse.status})`);

  const pdfBytes = Buffer.from(await pdfResponse.arrayBuffer());
  const id = safeSlug(paperId || pdfUrl.split("/").pop() || "paper");
  const queryDir = await resolveQueryFolder(query, runId);
  const outDir = path.join(queryDir, `pdf-${id}-${Date.now()}`);
  await mkdir(outDir, { recursive: true });
  const pdfPath = path.join(outDir, "source.pdf");
  const textPath = path.join(outDir, "text.txt");
  await writeFile(pdfPath, pdfBytes);
  const text = await extractPdfTextRobust(pdfBytes, pdfPath, outDir);
  if (!text.trim()) throw new Error(`PDF text extraction failed for ${pdfUrl}`);
  await writeFile(textPath, text, "utf8");
  return readFile(textPath, "utf8");
}

async function fetchPaperContentPreferHtml(input: AgentInput): Promise<string | undefined> {
  const { paper, query, runId } = input;
  if (paper.source === "acm") {
    const htmlUrl = paper.htmlUrl ?? (paper.doi ? toAcmHtmlUrl(paper.doi) : undefined);
    if (htmlUrl) {
      try {
        return await fetchHtmlContent(htmlUrl, ACM_CONTENT_TIMEOUT_MS);
      } catch {
        return paper.summary;
      }
    }
    return paper.summary;
  }

  const htmlUrl =
    paper.htmlUrl ??
    (paper.source === "arxiv" && paper.url ? toArxivHtmlUrl(paper.url) : undefined);
  if (htmlUrl) {
    try {
      return await fetchHtmlContent(htmlUrl);
    } catch {
      // Fall through to PDF extraction when a provider has no usable HTML.
    }
  }

  const pdfUrl =
    paper.pdfUrl ??
    (paper.source === "arxiv" && paper.url ? toArxivPdfUrl(paper.url) : undefined);
  if (!pdfUrl) return undefined;
  return fetchPdfFallbackContent(pdfUrl, paper.id, query, runId);
}

/**
 * Orchestrator: runs all three agents in parallel and returns one card.
 *
 * Each agent's return type is inferred, so owners can freely evolve their
 * output shape inside their own folder without editing this file.
 */
export async function buildSummaryCard(input: AgentInput) {
  const fullText =
    input.fullText ?? (await fetchPaperContentPreferHtml(input).catch(() => undefined));
  const enrichedInput = fullText ? { ...input, fullText } : input;
  const [summaryResult, figuresResult, methodologyResult] = await Promise.allSettled([
    runSummaryAgent(enrichedInput),
    runFiguresAgent(enrichedInput),
    runMethodologyAgent(enrichedInput),
  ]);
  const summary =
    summaryResult.status === "fulfilled"
      ? summaryResult.value
      : { oneLine: input.paper.title, paragraph: input.paper.summary ?? "" };
  const figures = figuresResult.status === "fulfilled" ? figuresResult.value : { figures: [] };
  const methodology =
    methodologyResult.status === "fulfilled"
      ? methodologyResult.value
      : { methodology: "", results: "", futureWork: "" };
  return { summary, figures, methodology };
}

export type SummaryCard = Awaited<ReturnType<typeof buildSummaryCard>>;
export type { AgentInput } from "./types";
