# Research Citation Mapper

A minimal Next.js app that turns a research topic into an interactive graph of recent papers and their most-cited references. Type a query, see seed papers from arXiv as nodes, then watch the graph expand with high-impact citations discovered through Semantic Scholar and hydrated from arXiv.

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

No API keys are required — the app calls public arXiv and Semantic Scholar endpoints anonymously.

## How It Works

The flow is a two-phase pipeline orchestrated by `app/page.tsx`:

1. **Seeds** — `POST /api/research/seeds`
   - `lib/arxiv.ts` queries `export.arxiv.org` for up to 20 recent papers (default: last 365 days), parses the Atom XML, and returns `ResearchPaper[]`.
   - `lib/graph.ts#buildSeedGraph` lays the seeds out in a centered grid with collision avoidance.
   - The run is persisted to `./data/<runId>/` (`query.json`, `seeds.json`, `seed-graph.json`) via `lib/storage.ts`.

2. **Citations** — `POST /api/research/citations`
   - For each seed, `lib/semanticScholar.ts` calls `api.semanticscholar.org` for that paper's references, keeps arXiv-backed matches, and ranks candidates by `10 * influentialCitationCount + citationCount`.
   - The selected citation nodes are fetched from arXiv by id, so stored titles, abstracts, authors, dates, URLs, and node ids come from arXiv while S2 citation counts are retained as ranking/display metrics.
   - Children are deduped across seeds (a paper cited by multiple seeds shows up once with multiple incoming edges).
   - `buildCitationGraph` reuses the seed positions and places each child in a hashed lane/tier below its parents, then draws `smoothstep` edges from parent to child.
   - Results are saved as `citations.json`, `citation-nodes.json`, and `graph.json` under the same `runId`.

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
│   ├── arxiv.ts                       # arXiv API client (XML search + id lookup)
│   ├── semanticScholar.ts             # S2 reference discovery + arXiv hydration
│   ├── graph.ts                       # node/edge layout
│   └── storage.ts                     # filesystem persistence
├── public/                            # static assets
└── data/                              # per-run JSON output (gitignored)
```

## Data Model

Defined in `lib/papers.ts`:

- `ResearchPaper` — `{ id, source, title, summary?, authors[], year?, published?, url?, arxivId?, citationCount?, influentialCitationCount? }`
- `CitationSelection` — `{ parentId, children: ResearchPaper[] }`
- `GraphNodeData` — `{ label, subtitle?, kind: "seed" | "citation" }`

IDs are namespaced by source. Current seed and citation nodes are stored as `arxiv:<id>` because arXiv is the metadata source; citation candidates that match existing seed ids are skipped to avoid duplicate graph nodes.

## Notes

- **No database.** Each run is persisted as JSON under `./data/<runId>/` (gitignored). Fine for local hacking; replace with a real store before deploying.
- **No auth on external APIs.** Semantic Scholar is rate-limited unauthenticated, so per-seed failures are swallowed and just produce empty children for that seed.
- **Deterministic layout.** Child lane/tier selection is driven by a hash of the paper id, so the same data renders the same map every time.
