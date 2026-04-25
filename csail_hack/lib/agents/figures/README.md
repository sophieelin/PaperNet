# Agent #2 — Figures

Goal: surface the most impactful figures (charts, diagrams, screenshots) from
a paper, ranked by how well they communicate the headline result.

## Inputs

`AgentInput` from `../types.ts`:

- `paper`: `ResearchPaper` (with `arxivId` you can fetch the PDF / source).
- `fullText` (optional).

## Output

```ts
type Figure = {
  imageUrl: string;     // hosted or data URL
  caption?: string;     // verbatim caption from the paper
  description?: string; // optional LLM-written explanation
};

type FiguresResult = {
  figures: Figure[];    // ordered by impact, top first
};
```

Extend this type as needed (e.g. `figureNumber`, `pageNumber`,
`thumbnailUrl`). Only the `figures/` folder needs to change.

## Suggested approach

1. Pull the PDF (or LaTeX source) for the arXiv id.
2. Extract figures + captions (e.g. `pdffigures2`, `pdfplumber`,
   `unstructured`, or a vision LLM pass).
3. Score them (caption length, mentions in abstract/conclusion, "Figure 1"
   bias, etc.) and return the top 3–5.
4. Host or inline the chosen images.

## Notes

- Don't modify `lib/agents/types.ts` or `lib/agents/index.ts` unless the
  shared contract genuinely needs a new field.
