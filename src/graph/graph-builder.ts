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
  maxDepth?: number;
  relationshipTypes?: RelationshipType[];
}

export interface TraversalResult {
  entity: GraphEntity;
  depth: number;
  via?: GraphRelationship;
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
