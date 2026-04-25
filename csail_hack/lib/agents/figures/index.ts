import type { AgentInput } from "../types";

/**
 * Agent #2 — most impactful graphs / images from the paper.
 *
 * Owners may freely change the shape of `FiguresResult` and the implementation
 * below. See ./README.md for the full spec.
 */
export type Figure = {
  imageUrl: string;
  caption?: string;
  description?: string;
};

export type FiguresResult = {
  figures: Figure[];
};

export async function runFiguresAgent(
  _input: AgentInput,
): Promise<FiguresResult> {
  // TODO(agent-2): replace with real figure extraction + ranking.
  return {
    figures: [],
  };
}
