import type { AgentInput } from "../types";

/**
 * Agent #3 — methodology, results, and future work.
 *
 * Owners may freely change the shape of `MethodologyResult` and the
 * implementation below. See ./README.md for the full spec.
 */
export type MethodologyResult = {
  methodology: string;
  results: string;
  futureWork: string;
};

export async function runMethodologyAgent(
  _input: AgentInput,
): Promise<MethodologyResult> {
  // TODO(agent-3): replace with real extraction + LLM summarization.
  return {
    methodology: "",
    results: "",
    futureWork: "",
  };
}
