# Agents

Each agent produces one section of the paper summary card. They are designed
to be developed in parallel: every agent lives in its own folder and the
orchestrator infers the combined output type, so adding or changing fields in
one agent's result does not require touching any other file.

## Layout

```
lib/agents/
├── types.ts          # shared AgentInput only
├── index.ts          # orchestrator (buildSummaryCard) — usually no edits needed
├── summary/          # Agent #1 — owner: TBD
├── figures/          # Agent #2 — owner: TBD
└── methodology/      # Agent #3 — owner: TBD
```

## Contract

Every agent exports a single async function:

```ts
export async function runXxxAgent(input: AgentInput): Promise<XxxResult> { ... }
```

`AgentInput` is defined in `./types.ts` and is the only file shared by every
agent. Output shapes are owned by the agent folder.

## Adding a new agent

1. Create `lib/agents/<name>/index.ts` exporting `runXxxAgent`.
2. Add it to the `Promise.all` in `./index.ts`.
3. Add a `README.md` in the new folder describing the spec.
