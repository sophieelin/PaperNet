# Agent #2 — Figures

Goal: surface the most impactful figures (charts, diagrams, screenshots) from
a paper, ranked by how well they communicate the headline result.

## Inputs

`AgentInput` from `../types.ts`:

- `paper`: `ResearchPaper` (with provider URLs such as `htmlUrl`, `pdfUrl`, `arxivId`, or `doi`).
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

1. Use provider HTML when available so `<img>` links can be returned directly.
2. Ask the OpenAI figure selector to choose the single image that best
   summarizes the paper.
3. If only plain body text/PDF text is available, return no figure because
   there is no reliable image URL to show.

## Notes

- Don't modify `lib/agents/types.ts` or `lib/agents/index.ts` unless the
  shared contract genuinely needs a new field.
