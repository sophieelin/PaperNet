import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";

const dataRoot = path.join(process.cwd(), "data");

const safeSlug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 64);

export const createRunId = (query: string) =>
  `${safeSlug(query) || "research"}-${new Date().toISOString().replace(/[:.]/g, "-")}`;

export async function writeRunData(runId: string, fileName: string, payload: unknown) {
  const runDir = path.join(dataRoot, runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, fileName), JSON.stringify(payload, null, 2), "utf8");
}

export async function readRunData<T>(runId: string, fileName: string): Promise<T> {
  const raw = await readFile(path.join(dataRoot, runId, fileName), "utf8");
  return JSON.parse(raw) as T;
}

