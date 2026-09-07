import type { GraphEntity } from "./entity-extractor.js";
import type {
  GraphRelationship,
  RelationshipType,
} from "./relationship-extractor.js";

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

export function buildGraph(
  entities: GraphEntity[],
  relationships: GraphRelationship[],
): CodeGraph {
  const nodes = new Map<string, GraphEntity>();
  const outgoing = new Map<string, GraphRelationship[]>();
  const incoming = new Map<string, GraphRelationship[]>();

  for (const entity of entities) {
    nodes.set(entity.id, entity);
  }

  for (const relationship of relationships) {
    if (!outgoing.has(relationship.sourceId)) {
      outgoing.set(relationship.sourceId, []);
    }

    if (!incoming.has(relationship.targetId)) {
      incoming.set(relationship.targetId, []);
    }

    outgoing.get(relationship.sourceId)!.push(relationship);
    incoming.get(relationship.targetId)!.push(relationship);
  }

  return {
    nodes,
    edges: relationships,
    outgoing,
    incoming,
  };
}

export function getNode(
  graph: CodeGraph,
  entityId: string,
): GraphEntity | undefined {
  return graph.nodes.get(entityId);
}

export function getOutgoing(
  graph: CodeGraph,
  entityId: string,
  relationshipTypes?: RelationshipType[],
): GraphRelationship[] {
  const edges = graph.outgoing.get(entityId) ?? [];

  if (!relationshipTypes || relationshipTypes.length === 0) {
    return edges;
  }

  return edges.filter((edge) =>
    relationshipTypes.includes(edge.type),
  );
}

export function getIncoming(
  graph: CodeGraph,
  entityId: string,
  relationshipTypes?: RelationshipType[],
): GraphRelationship[] {
  const edges = graph.incoming.get(entityId) ?? [];

  if (!relationshipTypes || relationshipTypes.length === 0) {
    return edges;
  }

  return edges.filter((edge) =>
    relationshipTypes.includes(edge.type),
  );
}

export function getNeighbors(
  graph: CodeGraph,
  entityId: string,
  relationshipTypes?: RelationshipType[],
): GraphEntity[] {
  const neighborIds = new Set<string>();

  const outgoing = getOutgoing(
    graph,
    entityId,
    relationshipTypes,
  );

  const incoming = getIncoming(
    graph,
    entityId,
    relationshipTypes,
  );

  for (const edge of outgoing) {
    neighborIds.add(edge.targetId);
  }

  for (const edge of incoming) {
    neighborIds.add(edge.sourceId);
  }

  const neighbors: GraphEntity[] = [];

  for (const id of neighborIds) {
    const entity = graph.nodes.get(id);

    if (entity) {
      neighbors.push(entity);
    }
  }

  return neighbors;
}

export function traverseGraph(
  graph: CodeGraph,
  startEntityId: string,
  options: TraverseOptions = {},
): TraversalResult[] {
  const maxDepth = options.maxDepth ?? 2;

  const visited = new Set<string>();
  const results: TraversalResult[] = [];

  const queue: Array<{
    entityId: string;
    depth: number;
    via?: GraphRelationship;
  }> = [
      {
        entityId: startEntityId,
        depth: 0,
      },
    ];

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (visited.has(current.entityId)) {
      continue;
    }

    visited.add(current.entityId);

    const entity = graph.nodes.get(current.entityId);

    if (!entity) {
      continue;
    }

    results.push({
      entity,
      depth: current.depth,
      via: current.via,
    });

    if (current.depth >= maxDepth) {
      continue;
    }

    const outgoing = getOutgoing(
      graph,
      current.entityId,
      options.relationshipTypes,
    );

    const incoming = getIncoming(
      graph,
      current.entityId,
      options.relationshipTypes,
    );

    for (const edge of outgoing) {
      if (!visited.has(edge.targetId)) {
        queue.push({
          entityId: edge.targetId,
          depth: current.depth + 1,
          via: edge,
        });
      }
    }

    for (const edge of incoming) {
      if (!visited.has(edge.sourceId)) {
        queue.push({
          entityId: edge.sourceId,
          depth: current.depth + 1,
          via: edge,
        });
      }
    }
  }

  return results;
}

export function findEntitiesByName(
  graph: CodeGraph,
  name: string,
): GraphEntity[] {
  const normalized = name.toLowerCase();

  return Array.from(graph.nodes.values()).filter(
    (entity) =>
      entity.name.toLowerCase() === normalized,
  );
}

export function getGraphStats(graph: CodeGraph) {
  const entityCounts = new Map<string, number>();
  const relationshipCounts = new Map<string, number>();

  for (const entity of graph.nodes.values()) {
    entityCounts.set(
      entity.type,
      (entityCounts.get(entity.type) ?? 0) + 1,
    );
  }

  for (const edge of graph.edges) {
    relationshipCounts.set(
      edge.type,
      (relationshipCounts.get(edge.type) ?? 0) + 1,
    );
  }

  return {
    totalNodes: graph.nodes.size,
    totalEdges: graph.edges.length,
    entityCounts: Object.fromEntries(entityCounts),
    relationshipCounts: Object.fromEntries(
      relationshipCounts,
    ),
  };
}

export const graphBuilder = {
  async indexRepository(repository: Repository) {
    const parsedFiles = await parseRepository(repository.localPath);
    const entities = extractEntities(parsedFiles);
    const relationships = extractRelationships(parsedFiles, entities);
    const nodes: CodeGraphNode[] = entities.map((entity) => ({
      id: entity.id,
      filePath: entity.filePath ?? "",
      name: entity.name,
      kind: entity.type === "file" ? "module" : entity.type,
      startLine: entity.startLine ?? 1,
      endLine: entity.endLine ?? entity.startLine ?? 1,
    }));
    const edges: CodeGraphEdge[] = relationships.map((relationship) => ({
      sourceId: relationship.sourceId,
      targetId: relationship.targetId,
      relationship:
        relationship.type === "contains" ||
        relationship.type === "imports" ||
        relationship.type === "calls"
          ? relationship.type
          : "references",
    }));
    const symbols: CodeSymbol[] = nodes.map((node) => ({
      id: node.id,
      repositoryId: repository.id,
      filePath: node.filePath,
      name: node.name,
      kind: node.kind,
      startLine: node.startLine,
      endLine: node.endLine,
      language: "unknown",
    }));

    return { nodes, edges, symbols };
  },
};

import { parseRepository } from "../ingestion/parser.js";
import { extractEntities } from "./entity-extractor.js";
import { extractRelationships } from "./relationship-extractor.js";
import type {
  CodeGraphEdge,
  CodeGraphNode,
  CodeSymbol,
  Repository,
} from "../types/git.js";
