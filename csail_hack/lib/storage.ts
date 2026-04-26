import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Default data path when no `data` dir exists yet (first run creates it).
 */
function defaultDataPath(): string {
  const cwd = process.cwd();
  return path.join(
    cwd,
    path.basename(cwd) === "csail_hack" ? "data" : path.join("csail_hack", "data"),
  );
}

/**
 * Resolves the directory where run folders (`<runId>/graph.json`, etc.) live.
 *
 * The dev server cwd varies (app root, monorepo folder, or one level up), so
 * a single `join(cwd, "data")` often pointed at the wrong or empty directory.
 * We probe several layouts and **prefer a directory that already contains at
 * least one run** (`…/<runId>/graph.json`) so "Previous runs" and loads match
 * where data was actually written.
 */
export function getDataRoot(): string {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, "data"),
    path.join(cwd, "csail_hack", "data"),
    path.join(cwd, "AgenticAi_Hackathon", "csail_hack", "data"),
  ];

  const existing = candidates.filter((p) => {
    try {
      return existsSync(p) && statSync(p).isDirectory();
    } catch {
      return false;
    }
  });

  if (existing.length === 0) {
    return defaultDataPath();
  }

  const countValidRuns = (dir: string): number => {
    try {
      return readdirSync(dir, { withFileTypes: true }).filter(
        (e) =>
          e.isDirectory() &&
          existsSync(path.join(dir, e.name, "graph.json")),
      ).length;
    } catch {
      return 0;
    }
  };

  existing.sort((a, b) => countValidRuns(b) - countValidRuns(a));
  const best = existing[0]!;
  // If every existing `data` dir is empty, don’t pick an arbitrary one —
  // that caused reads to target ./data while runs lived under ./csail_hack/data.
  if (countValidRuns(best) === 0) {
    return defaultDataPath();
  }
  return best;
}

/**
 * All paths where a `data` folder could live (some projects nest the app).
 * Used to find/list runs when the "primary" getDataRoot() is wrong.
 */
export function getCandidateDataRoots(): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, "data"),
    path.join(cwd, "csail_hack", "data"),
    path.join(cwd, "AgenticAi_Hackathon", "csail_hack", "data"),
  ];
}

/**
 * Directory for this run if it exists under any candidate data root
 * (folder present — may not have graph yet).
 */
export function findRunDirectory(runId: string): string | null {
  for (const root of getCandidateDataRoots()) {
    const runDir = path.join(root, runId);
    try {
      if (existsSync(runDir) && statSync(runDir).isDirectory()) {
        return runDir;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

/**
 * Run directory that has a `graph.json` (loadable in history) under any root.
 */
export function findRunDirectoryWithGraph(runId: string): string | null {
  for (const root of getCandidateDataRoots()) {
    const graphPath = path.join(root, runId, "graph.json");
    if (existsSync(graphPath)) {
      return path.join(root, runId);
    }
  }
  return null;
}

/** Union of all run ids that have `graph.json` in any candidate data directory. */
export function listAllRunIdsWithGraph(): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const root of getCandidateDataRoots()) {
    if (!existsSync(root) || !statSync(root).isDirectory()) continue;
    let entries;
    try {
      entries = readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (!existsSync(path.join(root, e.name, "graph.json"))) continue;
      if (seen.has(e.name)) continue;
      seen.add(e.name);
      ids.push(e.name);
    }
  }
  ids.sort((a, b) => b.localeCompare(a));
  return ids;
}

const safeSlug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 64);

export const createRunId = (query: string) =>
  `${safeSlug(query) || "research"}-${new Date().toISOString().replace(/[:.]/g, "-")}`;

export async function writeRunData(runId: string, fileName: string, payload: unknown) {
  const runDir = path.join(getDataRoot(), runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, fileName), JSON.stringify(payload, null, 2), "utf8");
}

export async function readRunData<T>(runId: string, fileName: string): Promise<T> {
  const runDir = findRunDirectory(runId);
  if (!runDir) {
    throw new Error(`Run directory not found for ${runId}`);
  }
  const raw = await readFile(path.join(runDir, fileName), "utf8");
  return JSON.parse(raw) as T;
}

