# PaperNet — Dynamic Multi-Agent Knowledge Graph
## CSAIL Agentic AI Hackathon

## Authors

- **Sophie Lin** — [sophlin@mit.edu](mailto:sophlin@mit.edu) — Wellesley College ’27
- **Shrenik Patel** — [shrenik.d.patel@gmail.com](mailto:shrenik.d.patel@gmail.com) — Rutgers University ’26
- **Han Nguyen** — [hn103@wellesley.edu](mailto:hn103@wellesley.edu) — Wellesley College ’27
- **Kenneth Xiong** — [kxiong@olin.edu](mailto:kxiong@olin.edu) — Olin College ’27

A multi-agent system that continuously builds a living research graph by discovering, structuring, and synthesizing papers to reveal methods, citation lineages, emerging directions, and open problems.

## Motivation

Research discovery is still painfully manual: researchers spend hours tracing arXiv papers, following citation trails, and piecing together scattered notes just to understand what has been tried, which papers matter, and where the open problems are.

## Agentic Loop

Given a research topic, the agent breaks discovery into stages by finding strong seed papers, expanding through citation networks, pruning irrelevant references, clustering related work, and synthesizing the field’s key themes and open problems. It builds a dynamic graph of papers that enriches each node with summaries, methods, results, figures, and future directions, then refreshes the graph as new papers appear.

## Toolset

Custom agent harness and reasoning engine powered by **GPT‑5 series**, **React Flow** for graph visualization, **arXiv API** and **CrossRef API** for paper retrieval, **OCR** for PDF parsing, and **Semantic Scholar API** for citation metadata.

| Component | Role |
|-----------|------|
| GPT‑5 series | Summaries, clustering, methodology, figure selection, query refinement |
| Semantic Scholar API | Seed search, references, citation counts |
| arXiv API | Paper metadata and HTML/PDF-backed content |
| CrossRef API | DOI / ACM-style metadata hydration |
| OCR | PDF text when HTML is unavailable |
| React Flow | Interactive paper graph UI (`@xyflow/react`) |

## Autonomous Features

- Discovers relevant papers from the user’s research query and filters them to supported sources such as arXiv and ACM.
- Expands the graph by recursively retrieving citations and references from the initial paper set, then ranks and retains the most relevant and high-impact works using signals such as citation count, influential citations, and topical fit.
- Automatically maintains the research graph by adding new papers, restructuring clusters, generating summary cards, selecting representative figures, and inferring semantic edges between related papers.

---

## Code boilerplate

### Prerequisites

- **Node.js** 20+ recommended
- **npm** (ships with Node)

### Clone and install

```bash
git clone <your-repo-url>
cd csail_hack
npm install
```

### Environment

Create `csail_hack/.env.local`:

```bash
# Required for LLM-powered clustering, summary cards, figure selection, query refinement
OPENAI_API_KEY=sk-...

# Optional: higher Semantic Scholar rate limits
# SEMANTIC_SCHOLAR_API_KEY=...

# Optional model overrides (see routes / lib for usage)
# OPENAI_CLUSTER_MODEL=gpt-4o-mini
# OPENAI_QUERY_REFINE_MODEL=gpt-4o-mini
```

### Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and enter a research topic in the UI.

### Other scripts

```bash
npm run build   # production build
npm run start   # serve production build
npm run lint    # eslint
```

### Stack

- **Next.js** 16 · **React** 19 · **TypeScript** · **Tailwind** v4
- **React Flow** (`@xyflow/react`) + **dagre** for layout
- Data persisted under `./data/<runId>/` (JSON per run; no DB in the default setup)

### API flow (high level)

1. **`POST /api/research/seeds`** — Semantic Scholar search → supported arXiv/ACM seeds → seed graph.
2. **`POST /api/research/citations`** — References per seed, hydration, full graph + optional OpenAI clustering.
3. **`POST /api/research/summary-card`** — Multi-agent summaries, figures, methodology from HTML or PDF.

---

## Project structure

```
csail_hack/
├── app/
│   ├── page.tsx                 # Search + React Flow canvas
│   ├── layout.tsx
│   ├── globals.css
│   └── api/research/            # seeds, citations, summary-card, update, …
├── lib/
│   ├── agents/                  # Summary, figures, methodology agents
│   ├── papers.ts                # Shared types
│   ├── arxiv.ts                 # arXiv search + id lookup
│   ├── semanticScholar.ts      # S2 search + references
│   ├── graph.ts                 # Layout, clustering, semantic edges
│   ├── openaiClustering*.ts     # Optional LLM topic assignment
│   ├── figureImageUrl.ts        # Figure URL normalization / proxy
│   ├── refineSearchQuery.ts     # OpenAI search-query refinement
│   └── storage.ts
├── public/
└── data/                        # Per-run JSON (typically gitignored)
```
