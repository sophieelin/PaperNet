import { NextRequest, NextResponse } from "next/server";

/**
 * Fetches an image from arXiv (same process as a normal browser) and serves it
 * from our origin so the <img> request is not subject to hotlink / Referer
 * rules that can break when loading arxiv.org assets from local dev or other
 * origins.
 */
function isAllowedArxivImageHost(host: string): boolean {
  return host === "arxiv.org" || host.endsWith(".arxiv.org");
}

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("url");
  if (!raw) {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    try {
      target = new URL(decodeURIComponent(raw));
    } catch {
      return NextResponse.json({ error: "Invalid url" }, { status: 400 });
    }
  }

  if (target.protocol !== "https:" && target.protocol !== "http:") {
    return NextResponse.json({ error: "Invalid protocol" }, { status: 400 });
  }
  if (target.protocol === "http:") {
    target = new URL(target.toString().replace(/^http:/, "https:"));
  }
  if (!isAllowedArxivImageHost(target.hostname)) {
    return NextResponse.json({ error: "Host not allowed" }, { status: 403 });
  }

  const upstream = await fetch(target.toString(), {
    headers: {
      Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
      Referer: "https://arxiv.org/",
      "User-Agent":
        "Mozilla/5.0 (compatible; PaperNet/1.0; +https://arxiv.org) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
    next: { revalidate: 86_400 },
  });

  if (!upstream.ok) {
    return NextResponse.json(
      { error: upstream.statusText || "Upstream error" },
      { status: upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502 },
    );
  }

  const ct = upstream.headers.get("content-type") || "";
  if (ct.includes("text/html")) {
    return NextResponse.json({ error: "Upstream returned HTML" }, { status: 404 });
  }

  const buf = await upstream.arrayBuffer();
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": (() => {
        const base = ct.split(";")[0].trim() || "application/octet-stream";
        if (base === "application/octet-stream" && buf.byteLength > 100) {
          return "image/png";
        }
        return base.startsWith("image/") ? base : "image/png";
      })(),
      "Cache-Control": "public, max-age=604800, s-maxage=604800",
    },
  });
}
