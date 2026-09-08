import { runMigrations } from "./migrate.js";

export const EMBEDDING_DIMENSION = 384;

export const initializeSchema = (): Promise<void> => runMigrations();
