import type { AgentInput } from "../types";

/**
 * Agent #2 — most impactful graph / image from the paper.
 *
 * The agent only attempts figure selection when given HTML with image links.
 * Plain paper-body text cannot identify a concrete image URL, so it returns no
 * figure rather than guessing.
 */
export type Figure = {
  imageUrl: string;
  caption?: string;
  description?: string;
  figureNumber?: string;
};

export type FiguresResult = {
  figures: Figure[];
};

type FigureCandidate = Figure & {
  id: string;
  sourceIndex: number;
  altText?: string;
};

type OpenAIFigureSelection = {
  selectedImageUrl: string | null;
  figureNumber?: string;
  caption?: string;
  description?: string;
};

const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-4.1-mini";
const MAX_CANDIDATES = 24;
const MAX_CAPTION_LENGTH = 700;

const decodeHtml = (value: string) =>
  value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

const stripTags = (html: string) =>
  decodeHtml(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " "))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const truncate = (value: string | undefined, maxLength = MAX_CAPTION_LENGTH) => {
  if (!value) return undefined;
  return value.length > maxLength ? `${value.slice(0, maxLength - 3).trim()}...` : value;
};

const getAttribute = (html: string, attribute: string) => {
  const pattern = new RegExp(`${attribute}\\s*=\\s*["']([^"']+)["']`, "i");
  return html.match(pattern)?.[1];
};

const normalizeArxivFigureUrl = (url: string) => {
  if (!url.startsWith("https://arxiv.org/")) return url;
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const withHtml =
      segments[0] === "html" ? segments : ["html", ...segments];

    // Fix duplicate-id bug: /html/<id>/<id>/... -> /html/<id>/...
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
};

const absoluteUrl = (url: string, paper?: AgentInput["paper"]) => {
  try {
    const raw = url.trim();
    if (/^https?:\/\//i.test(raw)) return normalizeArxivFigureUrl(raw);

    const arxivId = paper?.arxivId ?? "";
    if (raw.startsWith("/")) {
      return normalizeArxivFigureUrl(`https://arxiv.org${raw}`);
    }
    if (arxivId) {
      return normalizeArxivFigureUrl(`https://arxiv.org/html/${arxivId}/${raw}`);
    }
    return normalizeArxivFigureUrl(`https://arxiv.org/html/${raw}`);
  } catch {
    return normalizeArxivFigureUrl(url);
  }
};

const isHtmlWithImages = (content?: string): content is string =>
  Boolean(content && /<[^>]+>/i.test(content) && /<img\b/i.test(content));

const extractFigureNumber = (caption: string | undefined, index: number) =>
  caption?.match(/\b(?:fig(?:ure)?\.?)\s*([0-9]+[a-z]?)/i)?.[1] ?? String(index + 1);

const toCandidate = (
  imageTag: string,
  sourceIndex: number,
  paper: AgentInput["paper"],
  caption?: string,
): FigureCandidate | null => {
  const rawImageUrl = getAttribute(imageTag, "src") ?? getAttribute(imageTag, "data-src");
  if (!rawImageUrl) return null;

  const cleanCaption = truncate(caption?.replace(/\s+/g, " ").trim());
  const altText = truncate(getAttribute(imageTag, "alt")?.replace(/\s+/g, " ").trim(), 300);
  const imageUrl = absoluteUrl(rawImageUrl, paper);
  return {
    id: `figure-${sourceIndex + 1}`,
    sourceIndex,
    imageUrl,
    caption: cleanCaption,
    altText,
    figureNumber: extractFigureNumber(cleanCaption ?? altText, sourceIndex),
  };
};

const dedupeCandidates = (candidates: FigureCandidate[]) => {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.imageUrl)) return false;
    seen.add(candidate.imageUrl);
    return true;
  });
};

const extractFigureCandidates = (html: string, paper: AgentInput["paper"]): FigureCandidate[] => {
  const figureCandidates = [...html.matchAll(/<figure\b[\s\S]*?<\/figure>/gi)].flatMap(
    (match, index) => {
      const figureHtml = match[0];
      const imageTag = figureHtml.match(/<img\b[^>]*>/i)?.[0];
      const captionHtml = figureHtml.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i)?.[1];
      if (!imageTag) return [];
      return (
        toCandidate(imageTag, index, paper, captionHtml ? stripTags(captionHtml) : undefined) ?? []
      );
    },
  );

  if (figureCandidates.length > 0) return dedupeCandidates(figureCandidates).slice(0, MAX_CANDIDATES);

  const imageCandidates = [...html.matchAll(/<img\b[^>]*>/gi)].flatMap((match, index) =>
    toCandidate(match[0], index, paper) ?? [],
  );
  return dedupeCandidates(imageCandidates).slice(0, MAX_CANDIDATES);
};

const responseText = (response: unknown) => {
  if (typeof response !== "object" || response === null) return undefined;
  if ("output_text" in response && typeof response.output_text === "string") {
    return response.output_text;
  }

  const output = "output" in response && Array.isArray(response.output) ? response.output : [];
  for (const item of output) {
    if (typeof item !== "object" || item === null || !("content" in item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (typeof content === "object" && content !== null && "text" in content && typeof content.text === "string") {
        return content.text;
      }
    }
  }
};

const parseSelection = (text: string | undefined): OpenAIFigureSelection | undefined => {
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text) as OpenAIFigureSelection;
    return typeof parsed.selectedImageUrl === "string" || parsed.selectedImageUrl === null ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const selectFigureWithOpenAI = async (
  input: AgentInput,
  candidates: FigureCandidate[],
): Promise<OpenAIFigureSelection | undefined> => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return undefined;

  const model = process.env.OPENAI_FIGURES_MODEL ?? DEFAULT_MODEL;
  const response = await fetch(OPENAI_RESPONSES_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content:
            "You select the single figure image that best summarizes a research paper. Return only JSON that matches the schema. Choose null if none of the image candidates look like a paper figure.",
        },
        {
          role: "user",
          content: JSON.stringify({
            paper: {
              title: input.paper.title,
              summary: input.paper.summary,
              authors: input.paper.authors,
              year: input.paper.year,
            },
            task:
              "Pick the imageUrl for the one figure that best summarizes the paper's core idea, method, or headline result.",
            candidates: candidates.map(({ id, imageUrl, caption, altText, figureNumber }) => ({
              id,
              imageUrl,
              figureNumber,
              caption,
              altText,
            })),
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "figure_selection",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              selectedImageUrl: {
                type: ["string", "null"],
                description: "The exact imageUrl of the best figure, or null if no candidate is suitable.",
              },
              figureNumber: { type: "string" },
              caption: { type: "string" },
              description: {
                type: "string",
                description: "Brief explanation of why this figure best summarizes the paper.",
              },
            },
            required: ["selectedImageUrl", "figureNumber", "caption", "description"],
          },
        },
      },
    }),
  });

  if (!response.ok) return undefined;
  return parseSelection(responseText(await response.json()));
};

export async function runFiguresAgent(input: AgentInput): Promise<FiguresResult> {
  const fullText = input.fullText;
  if (!isHtmlWithImages(fullText)) return { figures: [] };

  const candidates = extractFigureCandidates(fullText, input.paper);
  if (candidates.length === 0) return { figures: [] };

  const selection = await selectFigureWithOpenAI(input, candidates).catch(() => undefined);
  if (!selection?.selectedImageUrl) return { figures: [] };

  const selected = candidates.find((candidate) => candidate.imageUrl === selection.selectedImageUrl);
  if (!selected) return { figures: [] };

  return {
    figures: [
      {
        imageUrl: selected.imageUrl,
        figureNumber: selection.figureNumber || selected.figureNumber,
        caption: selection.caption || selected.caption,
        description: selection.description,
      },
    ],
  };
}
