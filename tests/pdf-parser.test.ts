import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateTextQuality,
  normalizeExtractedText,
  parseDocumentContent,
} from "../src/ingestion/document-parser.js";
import { AppError } from "../src/errors/app-error.js";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";

test("evaluateTextQuality accurately scores clean vs garbled binary text", () => {
  const cleanText = "Player Prajapati wears jersey number 18. Player Rishabh wears jersey number 17.";
  const cleanMetrics = evaluateTextQuality(cleanText, "JERSEY.pdf", 1);

  assert.equal(cleanMetrics.detectedTextQuality, "good");
  assert.ok(cleanMetrics.score >= 0.55, "Clean text score must be >= 0.55");
  assert.ok(cleanMetrics.printableCharacterRatio >= 0.9);

  const garbledText = "\x00\x01\x02\x03\x04\x05 \uFFFD \uFFFD \uFFFD \uFFFD \uFFFD \uFFFD \uFFFD \uFFFD";
  const garbledMetrics = evaluateTextQuality(garbledText, "GARBLED.pdf", 1);

  assert.equal(garbledMetrics.detectedTextQuality, "unusable");
  assert.ok(garbledMetrics.score < 0.4, "Garbled text score must be < 0.4");
});

test("normalizeExtractedText cleans whitespace, control characters, and linebreaks", () => {
  const raw = "Player Prajapati-\n number 18 .\n\n\n\nSection 1";
  const normalized = normalizeExtractedText(raw);

  assert.ok(!normalized.includes("-\n"));
  assert.ok(!normalized.includes("   "));
  assert.ok(normalized.includes("Prajapatinumber 18"));
});

test("parseDocumentContent rejects unreadable/corrupted documents with EXTRACTION_FAILED", async () => {
  const metadata = {
    documentId: "doc-corrupt-test",
    filename: "corrupt.txt",
    mimeType: "text/plain",
    tenantId: "test-tenant",
    userId: "test-user",
  };

  const corruptBuffer = Buffer.from("\uFFFD \uFFFD \uFFFD \uFFFD \x00 \x01 \x02", "utf8");

  await assert.rejects(
    async () => {
      await parseDocumentContent(corruptBuffer, "corrupt.txt", metadata);
    },
    (err: any) => {
      return err instanceof AppError && err.statusCode === 422;
    },
  );
});

test("parseDocumentContent extracts page-aware clean content for plain documents", async () => {
  const metadata = {
    documentId: "doc-clean-test",
    filename: "roster.txt",
    mimeType: "text/plain",
    tenantId: "test-tenant",
    userId: "test-user",
  };

  const textContent = "Player Prajapati | Jersey: 18\nPlayer Rishabh | Jersey: 17";
  const parsed = await parseDocumentContent(Buffer.from(textContent, "utf8"), "roster.txt", metadata);

  assert.ok(parsed.sections.length > 0);
  assert.equal(parsed.metadata.parserVersion, "document-parser-v2");
  assert.ok(parsed.sections[0]?.content.includes("Prajapati | Jersey: 18"));
});

test("parseDocumentContent uses OCR for an image-only PDF", { timeout: 120_000 }, async () => {
  const canvas = createCanvas(1200, 500);
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "black";
  context.font = "40px Arial";
  context.fillText("Player Rahul Prajapati", 50, 100);
  context.fillText("Jersey Number 18", 50, 180);
  context.fillText("Team trains Monday and Thursday", 50, 260);

  const pdf = await PDFDocument.create();
  const image = await pdf.embedPng(await canvas.encode("png"));
  const page = pdf.addPage([600, 250]);
  page.drawImage(image, { x: 0, y: 0, width: 600, height: 250 });
  const bytes = await pdf.save();
  const metadata = {
    documentId: "doc-ocr-test",
    filename: "JERSEY.pdf",
    mimeType: "application/pdf",
    tenantId: "test-tenant",
    userId: "test-user",
  };

  const parsed = await parseDocumentContent(Buffer.from(bytes), metadata.filename, metadata);

  assert.equal(parsed.metadata.parserVersion, "document-parser-v3-ocr");
  assert.equal(parsed.sections[0]?.pageNumber, 1);
  assert.match(parsed.sections[0]?.content ?? "", /Prajapati/i);
  assert.match(parsed.sections[0]?.content ?? "", /18/);
});
