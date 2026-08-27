import { runMigrations } from "./migrate.js";

export const EMBEDDING_DIMENSION = 384;

export async function initializeSchema(): Promise<void> {
  await runMigrations();
}
