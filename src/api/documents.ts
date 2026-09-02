import crypto from "node:crypto";
import path from "node:path";
import type { Request, Response, NextFunction } from "express";
import { parseDocumentContent } from "../ingestion/document-parser.js";
import { chunkDocument } from "../ingestion/document-chunker.js";
import { indexDocument, deleteDocument } from "../ingestion/document-indexer.js";
import { query } from "../db/postgres.js";
import { AppError } from "../errors/app-error.js";
import { env } from "../config/env.js";

export async function uploadDocumentHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const context = req.tenantContext;
    if (!context) {
      throw new AppError("Tenant context is missing", "AUTHENTICATION_ERROR", 401);
    }
    const tenantId = context.tenantId;
    const userId = context.userId;

    const filename = req.query.filename as string || "uploaded-document.txt";
    const mimeType = (req.headers["content-type"] as string) || "text/plain";

    let buffer: Buffer;
    if (Buffer.isBuffer(req.body)) {
      buffer = req.body;
    } else if (typeof req.body === "string") {
      buffer = Buffer.from(req.body, "utf-8");
    } else if (req.body && typeof req.body === "object" && Object.keys(req.body).length === 0) {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      buffer = Buffer.concat(chunks);
    } else {
      buffer = Buffer.from(JSON.stringify(req.body || {}), "utf-8");
    }

    if (!buffer || buffer.length === 0) {
      throw new AppError("Uploaded file is empty", "VALIDATION_ERROR", 400);
    }

    const documentId = `doc-${crypto.randomUUID()}`;
    const metadata = {
      documentId,
      filename: path.basename(filename),
      mimeType,
      tenantId,
      userId,
    };

    const parsed = await parseDocumentContent(buffer, filename, metadata);
    const docChunks = chunkDocument(parsed);

    if (env.ragDebugContext) {
      console.log(`[DOCUMENT CHUNKS] documentId=${documentId} filename=${metadata.filename}`);
      for (const chunk of docChunks) {
        console.log(`pageNumber=${chunk.pageNumber ?? "unknown"} chunkIndex=${chunk.chunkIndex}\n${chunk.content}`);
      }
      const completeText = docChunks.map((chunk) => chunk.content).join("\n");
      console.log(`OCR contains "28": ${/(^|\D)28(\D|$)/.test(completeText)}`);
      console.log(`OCR contains "Rishabh": ${/rishabh/i.test(completeText)}`);
    }

    if (docChunks.length === 0) {
      throw new AppError(
        `Unable to extract readable text from PDF '${metadata.filename}'. No readable content chunks generated.`,
        "EXTRACTION_FAILED",
        422,
      );
    }

    const indexResult = await indexDocument(metadata, buffer.length, docChunks);
    if (env.nodeEnv === "production" && indexResult.storage !== "postgres") {
      await deleteDocument(documentId, tenantId);
      throw new AppError(
        "Persistent document storage is unavailable. Upload was not accepted.",
        "PERSISTENCE_UNAVAILABLE",
        503,
      );
    }

    console.log(
      `[UPLOAD] documentId=${documentId} filename=${metadata.filename} totalChunks=${docChunks.length} tenantId=${tenantId} quality=${parsed.qualityMetrics?.detectedTextQuality ?? "good"} score=${parsed.qualityMetrics?.score ?? 1.0}`,
    );

    res.status(201).json({
      success: true,
      document: {
        id: documentId,
        filename: metadata.filename,
        mimeType,
        sizeBytes: buffer.length,
        chunks: docChunks.length,
        storage: indexResult.storage,
        tenantId,
        status: "ready",
        quality: parsed.qualityMetrics?.detectedTextQuality ?? "good",
        score: parsed.qualityMetrics?.score ?? 1.0,
      },
    });
  } catch (err: any) {
    if (err?.code === "EXTRACTION_FAILED" || err?.statusCode === 422) {
      res.status(422).json({
        success: false,
        error: {
          code: "EXTRACTION_FAILED",
          status: "extraction_failed",
          message: err.message || "Unable to extract readable text from this PDF.",
        },
      });
      return;
    }
    next(err);
  }
}

import { inMemoryDocumentStore } from "../ingestion/document-indexer.js";

export async function listDocumentsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const context = req.tenantContext;
    if (!context) {
      throw new AppError("Tenant context is missing", "AUTHENTICATION_ERROR", 401);
    }
    const tenantId = context.tenantId;
    let docs: any[] = [];

    try {
      const result = await query(
        `SELECT id, filename, mime_type, size_bytes, status, created_at FROM documents WHERE tenant_id = $1 ORDER BY created_at DESC;`,
        [tenantId],
      );
      docs = result.rows;
    } catch {
      // Fallback to in-memory document store
      docs = inMemoryDocumentStore
        .filter((d) => d.tenantId === tenantId)
        .map((d) => ({
          id: d.id,
          filename: d.filename,
          mime_type: d.mimeType,
          size_bytes: d.sizeBytes,
          status: d.status,
          created_at: d.createdAt,
        }));
    }

    if (docs.length === 0 && inMemoryDocumentStore.length > 0) {
      docs = inMemoryDocumentStore
        .filter((d) => d.tenantId === tenantId)
        .map((d) => ({
          id: d.id,
          filename: d.filename,
          mime_type: d.mimeType,
          size_bytes: d.sizeBytes,
          status: d.status,
          created_at: d.createdAt,
        }));
    }

    res.status(200).json({
      documents: docs,
    });
  } catch (err) {
    next(err);
  }
}

export async function deleteDocumentHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const context = req.tenantContext;
    if (!context) {
      throw new AppError("Tenant context is missing", "AUTHENTICATION_ERROR", 401);
    }
    const tenantId = context.tenantId;
    const rawDocId = req.params.id;
    const documentId = Array.isArray(rawDocId) ? rawDocId[0] : rawDocId;

    if (!documentId) {
      throw new AppError("Document ID is required", "VALIDATION_ERROR", 400);
    }

    const success = await deleteDocument(documentId, tenantId);
    if (!success) {
      throw new AppError("Document not found or unauthorized", "NOT_FOUND", 404);
    }

    res.status(200).json({ success: true, message: "Document deleted successfully" });
  } catch (err) {
    next(err);
  }
}
