import type { ResearchPaper } from "@/lib/papers";

/**
 * arXiv HTML images use relative src values like "x1.png" resolved against the
 * paper’s HTML **directory**. A base of `.../html/1234.5678` (no trailing
 * slash) is parsed as a **file** by URL(), so the parent becomes `.../html/`
 * and the image URL wrongly becomes `.../html/x1.png` (404). Always use a
 * trailing slash on the base. Prefer `html/arxivId` over `abs/arxivId` when
 * resolving.
 */

function toArxivHtmlPath(url: string): string {
  return url
    .trim()
    .replace(/^http:\/\//i, "https://")
    .replace("https://export.arxiv.org/", "https://arxiv.org/")
    .replace("https://arxiv.org/abs/", "https://arxiv.org/html/")
    .replace("https://arxiv.org/pdf/", "https://arxiv.org/html/")
    .replace(/\.pdf$/i, "");
}

function ensureTrailingSlashForDirectoryBase(root: string): string {
  return root.endsWith("/") ? root : `${root}/`;
}

/** Directory URL used to resolve relative image paths (must end with /). */
export function resolveArxivFigureBase(paper: ResearchPaper | undefined): string {
  if (!paper) return "https://arxiv.org/";
  if (paper.htmlUrl?.trim()) {
    return ensureTrailingSlashForDirectoryBase(toArxivHtmlPath(paper.htmlUrl.trim()));
  }
  if (paper.arxivId) {
    return `https://arxiv.org/html/${paper.arxivId}/`;
  }
  if (paper.url?.trim()) {
    return ensureTrailingSlashForDirectoryBase(toArxivHtmlPath(paper.url.trim()));
  }
  return "https://arxiv.org/";
}

const IMG_RE = /\.(png|jpe?g|gif|webp|svg)$/i;

/**
 * Best-effort repair for figure URLs that were stored before we fixed rel
 * resolution: `/html/x1.png`, `/html/abs/id/...`, `/html/extracted/...` without
 * the arXiv id prefix, etc.
 */
function repairMangledArxivFigureUrl(
  input: string,
  paper: ResearchPaper | undefined,
): string {
  const arxivId = paper?.arxivId
    ?.replace(/^arxiv:/i, "")
    ?.trim();
  try {
    const u = new URL(input);
    if (u.hostname !== "arxiv.org" && !u.hostname.endsWith(".arxiv.org")) {
      return input;
    }
    u.pathname = u.pathname.replace(/^\/html\/abs\//, "/html/");
    let path = u.pathname;
    if (arxivId) {
      const m = path.match(/^\/html\/([^/]+\.[^/]+)$/);
      if (m?.[1] && IMG_RE.test(m[1]) && m[1] !== arxivId) {
        u.pathname = `/html/${arxivId}/${m[1]}`;
        return u.toString();
      }
      if (path.startsWith("/html/extracted/") && !path.startsWith(`/html/${arxivId}/`)) {
        u.pathname = `/html/${arxivId}/extracted/${path.slice("/html/extracted/".length)}`;
        return u.toString();
      }
    }
    u.pathname = path;
    return u.toString();
  } catch {
    return input;
  }
}

/**
 * Full normalization used when ingesting <img> src from HTML (see figures
 * agent). Exposed so server and client stay consistent.
 */
export function normalizeArxivFigurePath(url: string): string {
  if (!url.startsWith("https://arxiv.org/")) return url;
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const withHtml = segments[0] === "html" ? segments : ["html", ...segments];

    if (
      withHtml.length >= 3 &&
      withHtml[0] === "html" &&
      withHtml[1] === withHtml[2]
    ) {
      withHtml.splice(2, 1);
    }
    parsed.pathname = `/${withHtml.join("/")}`;
    return parsed.toString();
  } catch {
    if (url.startsWith("https://arxiv.org/html/")) return url;
    return url.replace("https://arxiv.org/", "https://arxiv.org/html/");
  }
}

export function toAbsoluteFigureUrl(relativeOrAbsolute: string, paper: ResearchPaper | undefined): string {
  const raw = relativeOrAbsolute.trim();
  if (!raw) return raw;
  try {
    if (/^https?:\/\//i.test(raw)) return normalizeArxivFigurePath(raw);

    const baseUrl = resolveArxivFigureBase(paper);
    return normalizeArxivFigurePath(new URL(raw, baseUrl).toString());
  } catch {
    return normalizeArxivFigurePath(raw);
  }
}

/**
 * Public API for the paper detail <img> — entity fixes, arXiv repair, and
 * (when applicable) a same-origin proxy URL for arXiv hosts.
 */
export function resolveFigureImageUrl(url: string, paper: ResearchPaper): string {
  let u = url.trim();
  if (!u) return u;
  u = u.replace(/&amp;/g, "&");
  if (u.startsWith("//")) u = `https:${u}`;
  else if (u.startsWith("http://")) u = `https://${u.slice(7)}`;
  u = u.replace("export.arxiv.org", "arxiv.org");
  if (/^https?:\/\//i.test(u)) {
    u = repairMangledArxivFigureUrl(u, paper);
    return normalizeArxivFigurePath(u);
  }
  const base = resolveArxivFigureBase(paper);
  try {
    u = new URL(u, base).toString();
    u = repairMangledArxivFigureUrl(u, paper);
    return normalizeArxivFigurePath(u);
  } catch {
    return u;
  }
}

export function figureImageDisplayUrl(url: string, paper: ResearchPaper): string {
  const resolved = resolveFigureImageUrl(url, paper);
  if (!resolved.startsWith("http")) return resolved;
  try {
    const p = new URL(resolved);
    if (p.protocol !== "http:" && p.protocol !== "https:") return resolved;
    const h = p.hostname;
    if (h === "arxiv.org" || h.endsWith(".arxiv.org")) {
      return `/api/research/figure-image?url=${encodeURIComponent(p.toString())}`;
    }
  } catch {
    /* use resolved */
  }
  return resolved;
}
