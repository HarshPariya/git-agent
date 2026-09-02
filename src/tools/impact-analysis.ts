import type { CodeGraph } from "../graph/graph-builder.js";
import type { GraphEntity } from "../graph/entity-extractor.js";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface ImpactDependent {
  entity: GraphEntity;
  relationshipType: string;
  depth: number;
  via: string;
}

export interface ImpactAnalysisReport {
  target: {
    id: string;
    name: string;
    type: string;
    filePath?: string;
  };
  riskLevel: RiskLevel;
  riskScore: number; // 0 - 100
  directCallersCount: number;
  totalDependentsCount: number;
  maxDependencyDepth: number;
  explanation: string;
  directDependents: ImpactDependent[];
  downstreamDependents: ImpactDependent[];
}

export function analyzeImpact(
  targetName: string,
  graph: CodeGraph,
): ImpactAnalysisReport {
  let targetEntity: GraphEntity | undefined;

  for (const entity of graph.nodes.values()) {
    if (entity.name.toLowerCase() === targetName.toLowerCase()) {
      targetEntity = entity;
      break;
    }
  }

  if (!targetEntity) {
    throw new Error(`Target symbol or file '${targetName}' not found in code graph.`);
  }

  const directDependents: ImpactDependent[] = [];
  const downstreamDependents: ImpactDependent[] = [];
  const visited = new Set<string>([targetEntity.id]);

  const queue: Array<{ id: string; depth: number; via: string }> = [
    { id: targetEntity.id, depth: 0, via: targetEntity.name },
  ];

  let maxDepthFound = 0;
  let directCallersCount = 0;

  while (queue.length > 0) {
    const current = queue.shift()!;
    const incomingEdges = graph.incoming.get(current.id) ?? [];

    for (const incomingEdge of incomingEdges) {
      if (visited.has(incomingEdge.sourceId)) continue;

      visited.add(incomingEdge.sourceId);
      const sourceEntity = graph.nodes.get(incomingEdge.sourceId);

      if (!sourceEntity) continue;

      const depth = current.depth + 1;
      maxDepthFound = Math.max(maxDepthFound, depth);

      const dependentItem: ImpactDependent = {
        entity: sourceEntity,
        relationshipType: incomingEdge.type,
        depth,
        via: current.via,
      };

      if (incomingEdge.type === "calls") {
        if (depth === 1) directCallersCount++;
      }

      if (depth === 1) {
        directDependents.push(dependentItem);
      } else {
        downstreamDependents.push(dependentItem);
      }

      if (depth < 4) {
        queue.push({
          id: sourceEntity.id,
          depth,
          via: sourceEntity.name,
        });
      }
    }
  }

  const totalDependents = directDependents.length + downstreamDependents.length;
  const outgoingCount = (graph.outgoing.get(targetEntity.id) ?? []).length;

  // Calculate Risk Score (0 - 100)
  let riskScore = totalDependents * 15 + directCallersCount * 25 + maxDepthFound * 10;
  if (targetEntity.type === "file") riskScore += 20;

  riskScore = Math.min(100, Math.max(0, riskScore));

  let riskLevel: RiskLevel = "LOW";
  if (riskScore >= 30) riskLevel = "MEDIUM";
  if (riskScore >= 60) riskLevel = "HIGH";
  if (riskScore >= 85) riskLevel = "CRITICAL";

  const explanation = [
    `Impact Analysis for '${targetEntity.name}' (${targetEntity.type}):`,
    `Risk Level: ${riskLevel} (Score: ${riskScore}/100)`,
    `• ${directCallersCount} direct callers / usages`,
    `• ${totalDependents} total downstream dependents across ${maxDepthFound} hop(s)`,
    `• ${outgoingCount} outbound calls/imports`,
  ].join("\n");

  return {
    target: {
      id: targetEntity.id,
      name: targetEntity.name,
      type: targetEntity.type,
      ...(targetEntity.filePath !== undefined && { filePath: targetEntity.filePath }),
    },
    riskLevel,
    riskScore,
    directCallersCount,
    totalDependentsCount: totalDependents,
    maxDependencyDepth: maxDepthFound,
    explanation,
    directDependents,
    downstreamDependents,
  };
}
