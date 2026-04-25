# Agent #1 — Summary

Goal: produce two pieces of natural-language text about a paper.

- `oneLine`: a single sentence (~1 sentence, ~25 words). Plain English, no
  hedging, accurate to the paper's claim.
- `paragraph`: a 4–6 sentence paragraph that expands the one-liner with
  context, contribution, and significance.

## Inputs

`AgentInput` from `../types.ts`:

- `paper`: `ResearchPaper` — title, authors, year, abstract (`summary`),
  arXiv id, etc.
- `fullText` (optional): full paper text if/when the data layer provides it.

## Output

```ts
type SummaryResult = {
  oneLine: string;
  paragraph: string;
};
```

Feel free to extend this type (e.g. add `confidence`, `citations[]`) — only
the `summary/` folder needs to change.

## Notes

- No LLM client wired yet; pick whatever (OpenAI, Anthropic, local).
- Keep network calls inside this folder; do not modify `lib/agents/types.ts`
  or `lib/agents/index.ts` unless the contract genuinely needs a new shared
  field.
