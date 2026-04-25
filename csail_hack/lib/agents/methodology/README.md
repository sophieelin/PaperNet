# Agent #3 — Methodology, Results, Future Work

Goal: produce three short paragraphs covering how the paper does what it
does, what it found, and where it points next.

## Inputs

`AgentInput` from `../types.ts`:

- `paper`: `ResearchPaper`.
- `fullText` (optional).

## Output

```ts
type MethodologyResult = {
  methodology: string; // approach, datasets, models, training setup
  results: string;     // headline numbers, ablations, comparisons
  futureWork: string;  // limitations + author-stated next steps
};
```

Extend this type as needed (e.g. `metrics: Record<string, number>`,
`limitations: string[]`). Only the `methodology/` folder needs to change.

## Suggested approach

1. If `fullText` is missing, fetch and parse the PDF (or LaTeX source) using
   the `arxivId`.
2. Section-aware extraction: pull the Method/Approach, Results/Experiments,
   and Conclusion/Future Work sections.
3. Summarize each section with an LLM into 3–6 sentences.

## Notes

- Don't modify `lib/agents/types.ts` or `lib/agents/index.ts` unless the
  shared contract genuinely needs a new field.
