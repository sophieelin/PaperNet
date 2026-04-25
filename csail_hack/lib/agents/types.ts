import type { ResearchPaper } from "@/lib/papers";

/**
 * Shared input given to every agent.
 *
 * Add fields here as new sources of context become available (PDF text,
 * extracted figures, etc.). Keep this file small — each agent owns the shape
 * of its own output inside its own folder.
 */
export type AgentInput = {
  paper: ResearchPaper;
  fullText?: string;
};
