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

export const estimateTokens = (text: string): number =>
  Math.ceil(text.length / 4);

const formatLocation = (item: CompressedEvidence): string =>
  item.page ? `, page ${item.page}` : item.location ? `, ${item.location}` : "";

const formatEvidenceHeader = (item: CompressedEvidence): string =>
  `[${item.id}][${item.sourceType.toUpperCase()}] ${item.source}${formatLocation(item)}\n`;

const formatEvidenceBlock = (item: CompressedEvidence): string =>
  `[${item.id}][${item.sourceType.toUpperCase()}]\n${item.source}${formatLocation(item)}\n${item.content}`;

const truncateContent = (content: string, maxTokens: number): string =>
  `${content.slice(0, maxTokens * 4)}\n...[truncated]`;

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
    const { maxRetrievedChunks, maxRagContextTokens } = this.config;
    const activeEvidence: CompressedEvidence[] = [];
    let currentTokens = 0;
    let droppedChunkCount = 0;

    for (const item of evidence.slice(0, maxRetrievedChunks)) {
      const itemTokens = estimateTokens(`${formatEvidenceHeader(item)}${item.content}\n\n`);

      if (currentTokens + itemTokens <= maxRagContextTokens) {
        activeEvidence.push(item);
        currentTokens += itemTokens;
        continue;
      }

      const available = maxRagContextTokens - currentTokens;
      if (available > 100) {
        const truncatedItem = { ...item, content: truncateContent(item.content, available) };
        activeEvidence.push(truncatedItem);
        currentTokens += estimateTokens(`${formatEvidenceHeader(truncatedItem)}${truncatedItem.content}\n\n`);
        continue;
      }

      droppedChunkCount++;
    }

    droppedChunkCount += Math.max(0, evidence.length - maxRetrievedChunks);

    return {
      formattedEvidence: activeEvidence.map(formatEvidenceBlock).join("\n\n"),
      evidenceItems: activeEvidence,
      ragContextTokens: currentTokens,
      droppedChunkCount,
    };
  }

  fitMemory(memoryText: string): { formattedMemory: string; memoryTokens: number } {
    const memoryTokens = estimateTokens(memoryText);
    if (memoryTokens <= this.config.maxMemoryTokens) return { formattedMemory: memoryText, memoryTokens };

    const truncated = memoryText.slice(-this.config.maxMemoryTokens * 4);
    return { formattedMemory: truncated, memoryTokens: estimateTokens(truncated) };
  }
}
