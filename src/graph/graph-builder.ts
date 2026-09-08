import type { GraphEntity } from "./entity-extractor.js";
import type { GraphRelationship, RelationshipType } from "./relationship-extractor.js";
import { parseRepository } from "../ingestion/parser.js";
import { extractEntities } from "./entity-extractor.js";
import { extractRelationships } from "./relationship-extractor.js";
import type { CodeGraphEdge, CodeGraphNode, CodeSymbol, Repository } from "../types/git.js";

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

export function buildGraph(entities: GraphEntity[], relationships: GraphRelationship[]): CodeGraph {
  const nodes = new Map<string, GraphEntity>();
  const outgoing = new Map<string, GraphRelationship[]>();
  const incoming = new Map<string, GraphRelationship[]>();

  for (const entity of entities) nodes.set(entity.id, entity);
  for (const r of relationships) {
    if (!outgoing.has(r.sourceId)) outgoing.set(r.sourceId, []);
    if (!incoming.has(r.targetId)) incoming.set(r.targetId, []);
    outgoing.get(r.sourceId)!.push(r);
    incoming.get(r.targetId)!.push(r);
  }

  return { nodes, edges: relationships, outgoing, incoming };
}

export const getNode = (graph: CodeGraph, entityId: string): GraphEntity | undefined =>
  graph.nodes.get(entityId);

const filterByTypes = (edges: GraphRelationship[], types?: RelationshipType[]) =>
  !types?.length ? edges : edges.filter((e) => types.includes(e.type));

export const getOutgoing = (graph: CodeGraph, entityId: string, types?: RelationshipType[]): GraphRelationship[] =>
  filterByTypes(graph.outgoing.get(entityId) ?? [], types);

export const getIncoming = (graph: CodeGraph, entityId: string, types?: RelationshipType[]): GraphRelationship[] =>
  filterByTypes(graph.incoming.get(entityId) ?? [], types);

export function getNeighbors(graph: CodeGraph, entityId: string, types?: RelationshipType[]): GraphEntity[] {
  const neighborIds = new Set<string>();
  for (const edge of getOutgoing(graph, entityId, types)) neighborIds.add(edge.targetId);
  for (const edge of getIncoming(graph, entityId, types)) neighborIds.add(edge.sourceId);
  return Array.from(neighborIds).map((id) => graph.nodes.get(id)!).filter(Boolean);
}

export function traverseGraph(graph: CodeGraph, startEntityId: string, options: TraverseOptions = {}): TraversalResult[] {
  const maxDepth = options.maxDepth ?? 2;
  const visited = new Set<string>();
  const results: TraversalResult[] = [];
  const queue: Array<{ entityId: string; depth: number; via?: GraphRelationship }> = [{ entityId: startEntityId, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.entityId)) continue;
    visited.add(current.entityId);

    const entity = graph.nodes.get(current.entityId);
    if (!entity) continue;
    results.push({ entity, depth: current.depth, via: current.via });
    if (current.depth >= maxDepth) continue;

    for (const edge of getOutgoing(graph, current.entityId, options.relationshipTypes)) {
      if (!visited.has(edge.targetId)) queue.push({ entityId: edge.targetId, depth: current.depth + 1, via: edge });
    }
    for (const edge of getIncoming(graph, current.entityId, options.relationshipTypes)) {
      if (!visited.has(edge.sourceId)) queue.push({ entityId: edge.sourceId, depth: current.depth + 1, via: edge });
    }
  }

  return results;
}

export const findEntitiesByName = (graph: CodeGraph, name: string): GraphEntity[] => {
  const normalized = name.toLowerCase();
  return Array.from(graph.nodes.values()).filter((e) => e.name.toLowerCase() === normalized);
};

export function getGraphStats(graph: CodeGraph) {
  const entityCounts = new Map<string, number>();
  const relationshipCounts = new Map<string, number>();
  for (const entity of graph.nodes.values()) entityCounts.set(entity.type, (entityCounts.get(entity.type) ?? 0) + 1);
  for (const edge of graph.edges) relationshipCounts.set(edge.type, (relationshipCounts.get(edge.type) ?? 0) + 1);
  return {
    totalNodes: graph.nodes.size,
    totalEdges: graph.edges.length,
    entityCounts: Object.fromEntries(entityCounts),
    relationshipCounts: Object.fromEntries(relationshipCounts),
  };
}

export const graphBuilder = {
  async indexRepository(repository: Repository) {
    const parsedFiles = await parseRepository(repository.localPath);
    const entities = extractEntities(parsedFiles);
    const relationships = extractRelationships(parsedFiles, entities);
    const nodes: CodeGraphNode[] = entities.map((e) => ({
      id: e.id, filePath: e.filePath ?? "", name: e.name,
      kind: e.type === "file" ? "module" : e.type,
      startLine: e.startLine ?? 1, endLine: e.endLine ?? e.startLine ?? 1,
    }));
    const edges: CodeGraphEdge[] = relationships.map((r) => ({
      sourceId: r.sourceId, targetId: r.targetId,
      relationship: (["contains", "imports", "calls"].includes(r.type) ? r.type : "references") as CodeGraphEdge["relationship"],
    }));
    const symbols: CodeSymbol[] = nodes.map((n) => ({
      id: n.id, repositoryId: repository.id, filePath: n.filePath,
      name: n.name, kind: n.kind, startLine: n.startLine, endLine: n.endLine, language: "unknown",
    }));
    return { nodes, edges, symbols };
  },
};
