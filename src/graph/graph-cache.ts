import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { ParsedFile } from "../ingestion/parser.js";
import type { GraphEntity } from "./entity-extractor.js";
import type { GraphRelationship } from "./relationship-extractor.js";

export interface GraphCacheData {
  version: number;
  repositoryHash: string;
  createdAt: string;
  entities: GraphEntity[];
  relationships: GraphRelationship[];
}

const CACHE_VERSION = 2;
const DEFAULT_CACHE_PATH = path.join(process.cwd(), ".cache", "graphrag", "graph.json");

export const computeRepositoryHash = (parsedFiles: ParsedFile[]): string => {
  const hash = crypto.createHash("sha256");
  [...parsedFiles]
    .sort((a, b) => a.filePath.localeCompare(b.filePath))
    .forEach(({ filePath, content }) => {
      hash.update(filePath);
      hash.update(content);
    });
  return hash.digest("hex");
};

export const loadGraphCache = async (cachePath: string = DEFAULT_CACHE_PATH): Promise<GraphCacheData | null> => {
  try {
    const raw = await fs.readFile(cachePath, "utf-8");
    const data = JSON.parse(raw) as GraphCacheData;
    return data.version === CACHE_VERSION ? data : null;
  } catch {
    return null;
  }
};

export const saveGraphCache = async (
  data: Omit<GraphCacheData, "version" | "createdAt">,
  cachePath: string = DEFAULT_CACHE_PATH,
): Promise<void> => {
  let dirCreated = false;
  try {
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    dirCreated = true;
    const payload: GraphCacheData = {
      version: CACHE_VERSION,
      repositoryHash: data.repositoryHash,
      createdAt: new Date().toISOString(),
      entities: data.entities,
      relationships: data.relationships,
    };
    await fs.writeFile(cachePath, JSON.stringify(payload, null, 2), "utf-8");
  } catch (error) {
    console.warn("Failed to save graph cache:", error instanceof Error ? error.message : String(error));
  } finally {
    if (!dirCreated) {
      console.warn("Cache directory creation failed, skipping save");
    }
  }
};
