# Research Citation Mapper

A minimal Next.js app that turns a research topic into an interactive graph of related papers. Type a query, see seed papers discovered through Semantic Scholar, then watch the graph expand with cited papers from arXiv and ACM Digital Library.

Built with Next.js 16, React 19, TypeScript, Tailwind v4, and [`@xyflow/react`](https://reactflow.dev/) for the graph canvas.

## Getting Started

Install dependencies and start the dev server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and submit a topic in the search bar at the bottom of the screen.

Other scripts:

```bash
npm run build   # production build
npm run start   # run the production build
npm run lint    # eslint
```

No API keys are required to start — the app calls public Semantic Scholar, arXiv, Crossref, and ACM DL endpoints anonymously. Setting `SEMANTIC_SCHOLAR_API_KEY` gives Semantic Scholar requests their authenticated rate limit.

### Optional: OpenAI-powered topic clustering

If you set `OPENAI_API_KEY`, the citations route asks OpenAI (default `gpt-4o-mini`, in JSON mode) to cluster every seed and citation into 3–7 named subtopics. Each paper is then guaranteed to live under exactly one topic — both in colour and in spatial layout. Without the key, the app falls back to the built-in heuristic clusterer (bibliographic coupling + shared title phrases). Add it to a local `.env.local` like so:

```bash
# csail_hack/.env.local
OPENAI_API_KEY=sk-...
# Optional: pick a different model
# OPENAI_CLUSTER_MODEL=gpt-4o
```

Restart `npm run dev` after editing `.env.local`. You'll see `[citations] using OpenAI clustering: N topics` in the dev server log when it kicks in.

## How It Works

The flow is a two-phase pipeline orchestrated by `app/page.tsx`:

1. **Seeds** — `POST /api/research/seeds`
   - `lib/semanticScholar.ts#searchSupportedPapers` queries Semantic Scholar for relevant papers, then keeps supported records that have either an arXiv id or an ACM DOI.
   - `lib/graph.ts#buildSeedGraph` lays the seeds out in a centered grid with collision avoidance.
   - The run is persisted to `./data/<runId>/` (`query.json`, `seeds.json`, `seed-graph.json`) via `lib/storage.ts`.

2. **Cited papers** — `POST /api/research/citations`
   - `lib/semanticScholar.ts#fetchTopCitationsForSeeds` makes one Semantic Scholar references call per seed paper, keeps only cited papers with either an arXiv id or an ACM DOI, and ranks them by impact score (`10 * influentialCitationCount + citationCount`).
   - The top three cited papers per seed are hydrated from their source provider: arXiv records are fetched through arXiv, and ACM DOI records are filled through Crossref/ACM metadata.
   - Stored graph nodes carry provider-specific URLs: arXiv records use `arxiv.org/abs`, `/html`, and `/pdf`; ACM records use `dl.acm.org/doi`, `/doi/fullHtml`, and `/doi/pdf`.
   - Children are deduped across seeds (a paper related to multiple seeds shows up once with multiple incoming edges).
   - `buildCitationGraph` reuses the seed positions and places each child in a hashed lane/tier below its parents, then draws `smoothstep` edges from parent to child.
   - Results are saved as `citations.json`, `citation-nodes.json`, and `graph.json` under the same `runId`.

3. **Source content** — `POST /api/research/summary-card`
   - `lib/agents/index.ts` first tries the paper's provider HTML (`arxiv.org/html/<id>` or `dl.acm.org/doi/fullHtml/<doi>`).
   - arXiv falls back to PDF text extraction. ACM uses a short HTML attempt and then falls back to metadata/abstract text so slow ACM DL pages do not block the run.

The UI shows the seed-only graph as soon as phase 1 finishes, then swaps in the full citation graph when phase 2 returns. React Flow's `fitView` is called after each phase to reframe the camera.

## Project Structure

```
csail_hack/
├── app/
│   ├── page.tsx                       # search box + ReactFlow canvas (client)
│   ├── layout.tsx                     # root layout, fonts, metadata
│   ├── globals.css                    # Tailwind + theme tokens
│   └── api/research/
│       ├── seeds/route.ts             # POST query → seeds + seed graph
│       └── citations/route.ts         # POST runId → citations + full graph
├── lib/
│   ├── papers.ts                      # shared types
│   ├── arxiv.ts                       # arXiv API client (XML id lookup helpers)
│   ├── semanticScholar.ts             # S2 seed discovery + cited-paper ranking
│   ├── graph.ts                       # node/edge layout + heuristic clustering
│   ├── openaiClustering.ts            # optional LLM-driven topic assignment
│   └── storage.ts                     # filesystem persistence
├── public/                            # static assets
└── data/                              # per-run JSON output (gitignored)
```

## Data Model

Defined in `lib/papers.ts`:

- `ResearchPaper` — `{ id, source, title, summary?, authors[], year?, published?, url?, htmlUrl?, pdfUrl?, arxivId?, doi?, s2PaperId?, citationCount?, influentialCitationCount? }`
- `CitationSelection` — `{ parentId, children: ResearchPaper[] }`
- `GraphNodeData` — `{ label, subtitle?, kind: "seed" | "citation" }`

IDs are namespaced by source: `arxiv:<id>` for arXiv papers and `acm:<doi>` for ACM DL papers.

## Notes

- **No database.** Each run is persisted as JSON under `./data/<runId>/` (gitignored). Fine for local hacking; replace with a real store before deploying.
- **No auth on external APIs.** Semantic Scholar is used for seed search and per-seed reference lookup, with retry/backoff. Add `SEMANTIC_SCHOLAR_API_KEY` to reduce 429s.
- **Deterministic layout.** Child lane/tier selection is driven by a hash of the paper id, so the same data renders the same map every time.
