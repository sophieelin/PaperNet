/**
 * When search returns too few papers, we call OpenAI once to condense the user
 * query into short technical keywords, then retry the arXiv / Semantic Scholar
 * search.
 */

const CHAT_COMPLETIONS = "https://api.openai.com/v1/chat/completions";

/** If the first search yields fewer than this many papers, run OpenAI refinement (at most once). */
export const PAPER_COUNT_REFINE_THRESHOLD = 5;

export function shouldRefineSearchByPaperCount(paperCount: number): boolean {
  return paperCount < PAPER_COUNT_REFINE_THRESHOLD;
}

/**
 * Produces 3–8 technical keywords (space-separated) for literature search, or
 * `undefined` if the API is unavailable or the call fails.
 */
export async function refineSearchQueryForPaperSearch(
  longQuery: string,
): Promise<string | undefined> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return undefined;
  const model = process.env.OPENAI_QUERY_REFINE_MODEL?.trim() || "gpt-4o-mini";

  const res = await fetch(CHAT_COMPLETIONS, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 80,
      messages: [
        {
          role: "system",
          content:
            "You compress a verbose or conversational research request into a very short list of 3–8 technical search keywords for finding academic papers (arXiv / scholarly search). " +
            "Output ONLY those keywords, space-separated. No punctuation, no quotes, no labels, no explanation. " +
            "Prefer model names, task names, and domain terms (e.g. \"graph neural network protein\" not a full sentence). " +
            "Omit common stopwords.",
        },
        { role: "user", content: longQuery },
      ],
    }),
  });
  if (!res.ok) return undefined;

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) return undefined;

  const oneLine = text
    .replace(/[\n\r]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“”`]+|["'“”`]+$/g, "")
    .slice(0, 240);

  if (oneLine.length < 2) return undefined;
  if (oneLine.toLowerCase() === longQuery.trim().toLowerCase()) return undefined;
  return oneLine;
}
