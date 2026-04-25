import type { AgentInput } from "../types";

export type MethodologyResult = {
  methodology: string;
  results: string;
  futureWork: string;
};

export type MethodologyPrompt = {
  model: "gpt-4o-mini";
  system: string;
  user: string;
  outputSchema: {
    methodology: string;
    results: string;
    futureWork: string;
  };
};

function sanitizePaperText(input: string): string {
  return input.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

function trimForModelInput(input: string, maxChars = 60000): string {
  if (input.length <= maxChars) return input;
  return `${input.slice(0, maxChars)}\n\n[TRUNCATED_FOR_LENGTH]`;
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseMethodologyResult(raw: string): MethodologyResult | null {
  try {
    const parsed = JSON.parse(raw) as Partial<MethodologyResult>;
    return {
      methodology: safeString(parsed.methodology),
      results: safeString(parsed.results),
      futureWork: safeString(parsed.futureWork),
    };
  } catch {
    return null;
  }
}

function fallbackResult(): MethodologyResult {
  return {
    methodology: "",
    results: "",
    futureWork: "",
  };
}

export function buildMethodologyExtractionPrompt(paperText: string): MethodologyPrompt {
  const normalized = trimForModelInput(sanitizePaperText(paperText));

  return {
    model: "gpt-4o-mini",
    system:
      "You extract scientific paper sections for a researcher audience. Be faithful to the source text, avoid inventing claims, and use simple language.",
    user: [
      "Extract three clear in-depth sections from the paper content below:",
      "1) methodology: explain approach, data, setup, and key implementation choices in simple language.",
      "2) results: report core outcomes and headline numbers with plain-language interpretation.",
      "3) futureWork: summarize limitations and concrete next steps suggested by the paper.",
      "",
      "Rules:",
      "- Return JSON only with keys: methodology, results, futureWork.",
      "- If a section is missing, return an empty string for that key.",
      "- Keep each field to 6-10 sentences max.",
      "- Prefer exact evidence from the provided text.",
      "",
      "Paper content:",
      normalized,
    ].join("\n"),
    outputSchema: {
      methodology: "string",
      results: "string",
      futureWork: "string",
    },
  };
}

export async function runMethodologyAgent(
  input: AgentInput,
): Promise<MethodologyResult> {
  const paperText = input.fullText ?? "";
  if (!paperText.trim()) return fallbackResult();

  const prompt = buildMethodologyExtractionPrompt(paperText);
  const apiKey = process.env.CHATGPT_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing CHATGPT_API_KEY (or OPENAI_API_KEY) in environment.");
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: prompt.model,
      response_format: { type: "json_object" },
      temperature: 0.1,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${errorBody}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };

  const content = data.choices?.[0]?.message?.content ?? "";
  const parsed = parseMethodologyResult(content);
  return parsed ?? fallbackResult();
}

