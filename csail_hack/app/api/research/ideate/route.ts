import { NextResponse } from "next/server";
import { readRunData, writeRunData } from "@/lib/storage";

type SummaryCardsFile = Array<{
  paperId: string;
  card?: {
    summary?: { paragraph?: string };
    methodology?: { methodology?: string; results?: string; futureWork?: string };
  };
}>;

type IdeationResult = {
  exploredDirections: string[];
  futureDirections: string[];
};

const safeArray = (value: unknown) =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0) : [];

export async function POST(request: Request) {
  try {
    const { runId } = (await request.json()) as { runId?: string };
    if (!runId) return NextResponse.json({ error: "runId is required" }, { status: 400 });

    const cards = await readRunData<SummaryCardsFile>(runId, "summary-cards.json");
    const corpus = cards
      .map((entry) => {
        const paragraph = entry.card?.summary?.paragraph?.trim() ?? "";
        const methodology = entry.card?.methodology?.methodology?.trim() ?? "";
        const results = entry.card?.methodology?.results?.trim() ?? "";
        const futureWork = entry.card?.methodology?.futureWork?.trim() ?? "";
        return [paragraph, methodology, results, futureWork].filter(Boolean).join("\n");
      })
      .filter(Boolean)
      .join("\n\n---\n\n");

    if (!corpus.trim()) {
      return NextResponse.json(
        { error: "No summary-card text found. Generate summary cards first." },
        { status: 400 },
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Missing OPENAI_API_KEY." }, { status: 500 });

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-5-mini",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "You turn a pile of paper summaries into two flat lists.",
              "Be plain and specific. No rhetorical questions, no hype, no 'delve' or 'leverage' speak.",
              "Do not use em dashes. Use a comma, period, or 'and' instead.",
            ].join(" "),
          },
          {
            role: "user",
            content: [
              "From the text below, return JSON with:",
              "exploredDirections: 1-10 one-sentence items about what this corpus already does or repeats.",
              "futureDirections: 3-5 one-sentence items that look like good next steps. Ground them in the text.",
              "No em dashes in any string.",
              "",
              corpus,
            ].join("\n"),
          },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      return NextResponse.json({ error: `OpenAI request failed (${response.status}): ${body}` }, { status: 500 });
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content) as Partial<IdeationResult>;
    const result: IdeationResult = {
      exploredDirections: safeArray(parsed.exploredDirections).slice(0, 10),
      futureDirections: safeArray(parsed.futureDirections).slice(0, 5),
    };

    await writeRunData(runId, "ideation.json", result);
    return NextResponse.json({ runId, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ideation failed" },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const runId = url.searchParams.get("runId")?.trim();
  if (!runId) return NextResponse.json({ error: "runId is required" }, { status: 400 });

  try {
    const ideation = await readRunData<IdeationResult>(runId, "ideation.json");
    return NextResponse.json({ runId, ...ideation });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ideation not found";
    if (message.includes("ENOENT") || message.includes("File not found")) {
      return NextResponse.json({ runId, exploredDirections: [], futureDirections: [] });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

