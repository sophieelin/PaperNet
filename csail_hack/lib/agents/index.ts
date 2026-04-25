import { runFiguresAgent } from "./figures";
import { runMethodologyAgent } from "./methodology";
import { runSummaryAgent } from "./summary";
import type { AgentInput } from "./types";

/**
 * Orchestrator: runs all three agents in parallel and returns one card.
 *
 * Each agent's return type is inferred, so owners can freely evolve their
 * output shape inside their own folder without editing this file.
 */
export async function buildSummaryCard(input: AgentInput) {
  const [summary, figures, methodology] = await Promise.all([
    runSummaryAgent(input),
    runFiguresAgent(input),
    runMethodologyAgent(input),
  ]);
  return { summary, figures, methodology };
}

export type SummaryCard = Awaited<ReturnType<typeof buildSummaryCard>>;
export type { AgentInput } from "./types";
