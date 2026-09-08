import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { parseFile } from "./parser.js";
import { chunkFile, type CodeChunk } from "./chunker.js";
import { upsertChunks } from "../db/vector-store.js";
import { query } from "../db/postgres.js";
import { isIgnoredDirectory, isIgnoredFile, isPathWithinRoot, MAX_FILE_SIZE_BYTES } from "./cleaner.js";
import { toRepositoryPath } from "../retrieval/repository-path.js";

export interface IncrementalIndexStats { file: string; action: "indexed" | "deleted" | "skipped"; chunksCount: number; reason?: string; }

export class RepositoryIndexer {
  private readonly repositoryName: string;
  private readonly rootDirectory: string;
  private watcher: fsSync.FSWatcher | null = null;
  private debounceMap = new Map<string, NodeJS.Timeout>();

  constructor(rootDirectory: string, repositoryName = "ai-chatbot") { this.rootDirectory = path.resolve(rootDirectory); this.repositoryName = repositoryName; }

  public async indexSingleFile(filePath: string): Promise<IncrementalIndexStats> {
    const absolutePath = path.resolve(filePath);
    if (!isPathWithinRoot(absolutePath, this.rootDirectory) && absolutePath !== this.rootDirectory)
      return { file: filePath, action: "skipped", chunksCount: 0, reason: "Out of root boundary" };
    if (isIgnoredFile(path.basename(absolutePath)))
      return { file: filePath, action: "skipped", chunksCount: 0, reason: "Secret or ignored file" };
    let exists = false;
    try { const stat = await fs.stat(absolutePath); exists = true; if (stat.size > MAX_FILE_SIZE_BYTES) return { file: filePath, action: "skipped", chunksCount: 0, reason: "File exceeds 1 MB limit" }; }
    catch { exists = false; }
    if (!exists) return this.deleteFileFromIndex(absolutePath);
    const parsedFile = { ...(await parseFile(absolutePath)), filePath: toRepositoryPath(this.rootDirectory, absolutePath) };
    const chunks: CodeChunk[] = chunkFile(parsedFile);
    if (chunks.length === 0) return { file: filePath, action: "skipped", chunksCount: 0, reason: "No indexable content" };
    await upsertChunks(this.repositoryName, chunks);
    console.log(`⚡ Auto-Indexed changed file: ${path.basename(filePath)} (${chunks.length} chunks)`);
    return { file: filePath, action: "indexed", chunksCount: chunks.length };
  }

  public async deleteFileFromIndex(filePath: string): Promise<IncrementalIndexStats> {
    const normalizedPath = toRepositoryPath(this.rootDirectory, filePath);
    const result = await query(`DELETE FROM code_chunks WHERE repository = $1 AND file_path = $2`, [this.repositoryName, normalizedPath]);
    const deletedChunks = result.rowCount ?? 0;
    if (deletedChunks > 0) console.log(`🧹 Auto-Cleaned deleted file from DB: ${path.basename(filePath)} (${deletedChunks} chunks deleted)`);
    return { file: filePath, action: "deleted", chunksCount: deletedChunks };
  }

  public watchRepository(onChange?: (stats: IncrementalIndexStats) => void, debounceMs = 300): void {
    if (this.watcher) return;
    console.log(`👁 Starting automatic file watcher on ${this.rootDirectory}...`);
    this.watcher = fsSync.watch(this.rootDirectory, { recursive: true }, (_eventType, filename) => {
      if (!filename) return;
      const fullPath = path.join(this.rootDirectory, filename);
      if (filename.split(path.sep).some((part) => isIgnoredDirectory(part) || isIgnoredFile(part))) return;
      if (this.debounceMap.has(fullPath)) clearTimeout(this.debounceMap.get(fullPath));
      const timer = setTimeout(async () => {
        this.debounceMap.delete(fullPath);
        try { const stats = await this.indexSingleFile(fullPath); if (onChange) onChange(stats); }
        catch (err) { console.error(`❌ Error auto-indexing ${filename}:`, err); }
      }, debounceMs);
      this.debounceMap.set(fullPath, timer);
    });
  }

  public stopWatching(): void { if (this.watcher) { this.watcher.close(); this.watcher = null; console.log("🛑 Automatic file watcher stopped."); } }
}
