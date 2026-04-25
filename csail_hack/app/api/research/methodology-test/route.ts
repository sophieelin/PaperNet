import { NextResponse } from "next/server";
import { runMethodologyAgent } from "@/lib/agents/methodology";

type MethodologyTestRequest = {
  text?: string;
};

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    let rawText = "";

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const textField = form.get("text");
      const fileField = form.get("file");

      if (typeof textField === "string" && textField.trim()) {
        rawText = textField;
      } else if (fileField instanceof File) {
        rawText = await fileField.text();
      }
    } else {
      const { text } = (await request.json()) as MethodologyTestRequest;
      rawText = text ?? "";
    }

    const normalized = rawText.trim();
    if (!normalized) {
      return NextResponse.json(
        { error: "text is required (JSON) or file/text is required (multipart form)" },
        { status: 400 },
      );
    }

    const result = await runMethodologyAgent({
      paper: {
        id: "methodology-route-test",
        source: "arxiv",
        title: "Methodology Route Test",
        authors: [],
        summary: "",
      },
      fullText: normalized,
    });

    console.log("[methodology-test] input:");
    console.log(normalized);
    console.log("[methodology-test] output:");
    console.log(result);

    return NextResponse.json({ result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "methodology test failed" },
      { status: 500 },
    );
  }
}
