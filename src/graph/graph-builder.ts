import type { GraphEntity } from "./entity-extractor.js";
import type { GraphRelationship, RelationshipType } from "./relationship-extractor.js";
import { parseRepository } from "../ingestion/parser.js";
import { extractEntities } from "./entity-extractor.js";
import { extractRelationships } from "./relationship-extractor.js";
import type { CodeGraphEdge, CodeGraphNode, CodeSymbol, CodeSymbolKind, Repository } from "../types/git.js";

export interface CodeGraph {
  nodes: Map<string, GraphEntity>;
  edges: GraphRelationship[];
  outgoing: Map<string, GraphRelationship[]>;
  incoming: Map<string, GraphRelationship[]>;
}

export interface TraverseOptions {
  maxDepth?: number | undefined;
  relationshipTypes?: RelationshipType[] | undefined;
}

export interface TraversalResult {
  entity: GraphEntity;
  depth: number;
  via?: GraphRelationship | undefined;
}

const typeToKindMap: Record<GraphEntity["type"], CodeSymbolKind> = {
  file: "module",
  function: "function",
  class: "class",
  module: "module",
};

const edgeRelationshipMap: Record<string, CodeGraphEdge["relationship"]> = {
  contains: "contains",
  imports: "imports",
  calls: "calls",
};

const getMappedRelationship = (type: string): CodeGraphEdge["relationship"] =>
  edgeRelationshipMap[type] ?? "references";

export const buildGraph = (entities: GraphEntity[], relationships: GraphRelationship[]): CodeGraph => {
  const nodes = new Map<string, GraphEntity>();
  const outgoing = new Map<string, GraphRelationship[]>();
  const incoming = new Map<string, GraphRelationship[]>();

  entities.forEach((e) => nodes.set(e.id, e));
  relationships.forEach((r) => {
    const outgoingList = outgoing.get(r.sourceId);
    if (outgoingList) { outgoingList.push(r); } else { outgoing.set(r.sourceId, [r]); }
    const incomingList = incoming.get(r.targetId);
    if (incomingList) { incomingList.push(r); } else { incoming.set(r.targetId, [r]); }
  });

  return { nodes, edges: relationships, outgoing, incoming };
};

export const getNode = (graph: CodeGraph, entityId: string): GraphEntity | undefined =>
  graph.nodes.get(entityId);

const filterByTypes = (edges: GraphRelationship[], types?: RelationshipType[]) =>
  types?.length ? edges.filter((e) => types.includes(e.type)) : edges;

export const getOutgoing = (graph: CodeGraph, entityId: string, types?: RelationshipType[]): GraphRelationship[] =>
  filterByTypes(graph.outgoing.get(entityId) ?? [], types);

export const getIncoming = (graph: CodeGraph, entityId: string, types?: RelationshipType[]): GraphRelationship[] =>
  filterByTypes(graph.incoming.get(entityId) ?? [], types);

export const getNeighbors = (graph: CodeGraph, entityId: string, types?: RelationshipType[]): GraphEntity[] =>
  Array.from(
    new Set([
      ...getOutgoing(graph, entityId, types).map(({ targetId }) => targetId),
      ...getIncoming(graph, entityId, types).map(({ sourceId }) => sourceId),
    ])
  ).map((id) => graph.nodes.get(id)!).filter(Boolean);

export const traverseGraph = (
  graph: CodeGraph,
  startEntityId: string,
  { maxDepth = 2, relationshipTypes }: TraverseOptions = {}
): TraversalResult[] => {
  const visited = new Set<string>();
  const results: TraversalResult[] = [];
  const queue: Array<{ entityId: string; depth: number; via?: GraphRelationship }> = [
    { entityId: startEntityId, depth: 0 },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.entityId)) continue;
    visited.add(current.entityId);

    const entity = graph.nodes.get(current.entityId);
    if (!entity) continue;

    results.push({ entity, depth: current.depth, via: current.via });
    if (current.depth >= maxDepth) continue;

    const nextDepth = current.depth + 1;
    getOutgoing(graph, current.entityId, relationshipTypes)
      .filter(({ targetId }) => !visited.has(targetId))
      .forEach((edge) => queue.push({ entityId: edge.targetId, depth: nextDepth, via: edge }));

    getIncoming(graph, current.entityId, relationshipTypes)
      .filter(({ sourceId }) => !visited.has(sourceId))
      .forEach((edge) => queue.push({ entityId: edge.sourceId, depth: nextDepth, via: edge }));
  }

  return results;
};

export const findEntitiesByName = (graph: CodeGraph, name: string): GraphEntity[] => {
  const normalized = name.toLowerCase();
  return Array.from(graph.nodes.values()).filter((e) => e.name.toLowerCase() === normalized);
};

export const getGraphStats = (graph: CodeGraph) => {
  const countByType = <T extends { type: string }>(items: T[]): Record<string, number> =>
    Object.fromEntries(
      items.reduce((acc, item) => acc.set(item.type, (acc.get(item.type) ?? 0) + 1), new Map<string, number>())
    );

  return {
    totalNodes: graph.nodes.size,
    totalEdges: graph.edges.length,
    entityCounts: countByType(Array.from(graph.nodes.values())),
    relationshipCounts: countByType(graph.edges),
  };
};

export const graphBuilder = {
  async indexRepository(repository: Repository) {
    try {
      const parsedFiles = await parseRepository(repository.localPath);
      const entities = extractEntities(parsedFiles);
      const relationships = extractRelationships(parsedFiles, entities);

      const nodes: CodeGraphNode[] = entities.map(({ id, filePath, name, type, startLine, endLine }) => ({
        id,
        filePath: filePath ?? "",
        name,
        kind: typeToKindMap[type],
        startLine: startLine ?? 1,
        endLine: endLine ?? startLine ?? 1,
      }));

      const edges: CodeGraphEdge[] = relationships.map(({ sourceId, targetId, type }) => ({
        sourceId,
        targetId,
        relationship: getMappedRelationship(type),
      }));

      const symbols: CodeSymbol[] = nodes.map((n) => ({
        id: n.id,
        repositoryId: repository.id,
        filePath: n.filePath,
        name: n.name,
        kind: n.kind,
        startLine: n.startLine,
        endLine: n.endLine,
        language: "unknown",
      }));

      return { nodes, edges, symbols };
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  },
};
