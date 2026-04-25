import type { AgentInput } from "../types";

/**
 * Agent #1 — LLM-generated 1-sentence + 1-paragraph summary.
 *
 * Owners may freely change the shape of `SummaryResult` and the implementation
 * below. See ./README.md for the full spec.
 */
export type SummaryResult = {
  oneLine: string;
  paragraph: string;
};

export async function runSummaryAgent(
  _input: AgentInput,
): Promise<SummaryResult> {
  // TODO(agent-1): replace with real LLM call.
  return {
    oneLine: "",
    paragraph: "",
  };
}
