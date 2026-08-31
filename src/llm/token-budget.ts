import { env } from "../config/env.js";
import type { CompressedEvidence } from "../retrieval/context-compressor.js";

export interface TokenBudgetConfig {
  readonly maxRagContextTokens: number;
  readonly maxMemoryTokens: number;
  readonly maxSourceMetadataTokens: number;
  readonly maxRetrievedChunks: number;
}

export interface BudgetedContextResult {
  readonly formattedEvidence: string;
  readonly evidenceItems: readonly CompressedEvidence[];
  readonly ragContextTokens: number;
  readonly droppedChunkCount: number;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export class TokenBudgetManager {
  private readonly config: TokenBudgetConfig;

  constructor(customConfig?: Partial<TokenBudgetConfig>) {
    this.config = {
      maxRagContextTokens: customConfig?.maxRagContextTokens ?? env.maxRagContextTokens ?? 1200,
      maxMemoryTokens: customConfig?.maxMemoryTokens ?? env.maxMemoryTokens ?? 300,
      maxSourceMetadataTokens: customConfig?.maxSourceMetadataTokens ?? 150,
      maxRetrievedChunks: customConfig?.maxRetrievedChunks ?? env.maxRetrievedChunks ?? 4,
    };
  }

  fitEvidence(evidence: readonly CompressedEvidence[]): BudgetedContextResult {
    const activeEvidence: CompressedEvidence[] = [];
    let currentTokens = 0;
    let droppedChunkCount = 0;

    for (const item of evidence.slice(0, this.config.maxRetrievedChunks)) {
      const header = `[${item.id}][${item.sourceType.toUpperCase()}] ${item.source}${
        item.page ? `, page ${item.page}` : item.location ? `, ${item.location}` : ""
      }\n`;
      const itemText = `${header}${item.content}\n\n`;
      const itemTokens = estimateTokens(itemText);

      if (currentTokens + itemTokens <= this.config.maxRagContextTokens) {
        activeEvidence.push(item);
        currentTokens += itemTokens;
      } else {
        // Attempt safe truncation if first item or space allows
        const availableTokens = this.config.maxRagContextTokens - currentTokens;
        if (availableTokens > 100) {
          const maxChars = availableTokens * 4;
          const truncatedContent = item.content.slice(0, maxChars) + "\n...[truncated]";
          const truncatedItem: CompressedEvidence = {
            ...item,
            content: truncatedContent,
          };
          activeEvidence.push(truncatedItem);
          currentTokens += estimateTokens(`${header}${truncatedContent}\n\n`);
        } else {
          droppedChunkCount++;
        }
      }
    }

    droppedChunkCount += Math.max(0, evidence.length - this.config.maxRetrievedChunks);

    const formattedEvidence = activeEvidence
      .map(
        (item) =>
          `[${item.id}][${item.sourceType.toUpperCase()}]\n${item.source}${
            item.page ? `, page ${item.page}` : item.location ? `, ${item.location}` : ""
          }\n${item.content}`,
      )
      .join("\n\n");

    return {
      formattedEvidence,
      evidenceItems: activeEvidence,
      ragContextTokens: currentTokens,
      droppedChunkCount,
    };
  }

  fitMemory(memoryText: string): { formattedMemory: string; memoryTokens: number } {
    const memoryTokens = estimateTokens(memoryText);
    if (memoryTokens <= this.config.maxMemoryTokens) {
      return { formattedMemory: memoryText, memoryTokens };
    }

    const maxChars = this.config.maxMemoryTokens * 4;
    const truncated = memoryText.slice(-maxChars); // keep recent messages
    return {
      formattedMemory: truncated,
      memoryTokens: estimateTokens(truncated),
    };
  }
}
