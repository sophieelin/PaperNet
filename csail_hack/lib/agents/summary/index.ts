import type { AgentInput } from "../types";

/**
 * Agent #1 — LLM-generated 1-sentence + 1-paragraph summary.
 *
 * Owners may freely change the shape of `SummaryResult` and the implementation
 * below. See ./README.md for the full spec.
 */
export type SummaryResult = {
  oneLine: string;
  paragraph: string;
};

export type SummaryPrompt = {
  model: "gpt-4o-mini";
  system: string;
  user: string;
  outputSchema: {
    oneLine: string;
    paragraph: string;
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

function parseSummaryResult(raw: string): SummaryResult | null {
  try {
    const parsed = JSON.parse(raw) as Partial<SummaryResult>;
    return {
      oneLine: safeString(parsed.oneLine),
      paragraph: safeString(parsed.paragraph),
    };
  } catch {
    return null;
  }
}

function fallbackSummary(input: AgentInput): SummaryResult {
  return {
    oneLine: input.paper.title ?? "",
    paragraph: input.paper.summary ?? "",
  };
}

export function buildSummaryPrompt(input: AgentInput): SummaryPrompt {
  const sourceText = sanitizePaperText(input.fullText ?? input.paper.summary ?? "");
  const normalized = trimForModelInput(sourceText);

  return {
    model: "gpt-4o-mini",
    system:
      "You summarize scientific papers clearly and faithfully. Avoid fabricated claims and keep language concrete.",
    user: [
      "Produce a paper summary with JSON output only.",
      "Return keys exactly: oneLine, paragraph.",
      "",
      "Requirements:",
      "- oneLine: exactly 1 sentence; dense with core topic/method/findings keywords for semantic similarity search.",
      "- paragraph: 4-7 sentences about the entire paper (goal, method, data/setup, main results, and significance).",
      "- Redundancy between fields is allowed.",
      "- If details are missing, be explicit about uncertainty instead of guessing.",
      "",
      `Paper title: ${input.paper.title}`,
      `Paper abstract: ${input.paper.summary ?? ""}`,
      "",
      "Paper content:",
      normalized,
    ].join("\n"),
    outputSchema: {
      oneLine: "string",
      paragraph: "string",
    },
  };
}

export async function runSummaryAgent(
  input: AgentInput,
): Promise<SummaryResult> {
  const prompt = buildSummaryPrompt(input);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY in environment.");
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
      temperature: 0.2,
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
  const parsed = parseSummaryResult(content);
  return parsed ?? fallbackSummary(input);
}
