import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
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

const safeSlug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);

const execFileAsync = promisify(execFile);

export async function fetchArxivHtmlContent(arxivUrl: string): Promise<string> {
  const response = await fetch(toArxivHtmlUrl(arxivUrl), { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to fetch arXiv HTML (${response.status})`);
  return response.text();
}

async function resolveQueryFolder(query?: string, runId?: string): Promise<string> {
  const dataRoot = path.join(process.cwd(), "csail_hack", "data");
  if (runId) return path.join(dataRoot, runId);
  const slug = safeSlug(query ?? "");
  if (!slug) return path.join(dataRoot, "agent-pdf");

  const entries = await readdir(dataRoot, { withFileTypes: true }).catch(() => []);
  const candidates = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${slug}-`))
    .map((entry) => entry.name);
  if (candidates.length === 0) return path.join(dataRoot, slug);

  const withTimes = await Promise.all(
    candidates.map(async (name) => {
      const full = path.join(dataRoot, name);
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

  const py = `
import sys, os
import fitz

pdf_path, out_dir = sys.argv[1], sys.argv[2]
doc = fitz.open(pdf_path)
pages = []
for page in doc:
    pages.append(page.get_text())
text = "\\n\\f\\n".join(pages)
with open(os.path.join(out_dir, "text.txt"), "w", encoding="utf-8") as f:
    f.write(text)
print(str(len(text)))
`;

  await execFileAsync("python3", ["-c", py, pdfPath, outDir], { maxBuffer: 20 * 1024 * 1024 });
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
