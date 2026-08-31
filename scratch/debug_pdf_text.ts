import fs from "node:fs/promises";
import path from "node:path";
import { parseDocumentContent } from "../src/ingestion/document-parser.js";

async function testPdf() {
  try {
    // Find any PDF in current directory or user desktop
    const files = await fs.readdir(process.cwd());
    console.log("Workspace files:", files);

    // Let's create a test PDF/txt buffer representing JERSEY.pdf with Prajapati jersey content
    const testContent = `
Player Jersey List 2026:
- Prajapati: Jersey #18 (All-Rounder)
- Rishabh: Jersey #17 (Wicket Keeper)
- Vikas: Jersey #45 (Batsman)
    `.trim();

    const metadata = {
      documentId: "doc-jersey-test",
      filename: "JERSEY.pdf",
      mimeType: "application/pdf",
      tenantId: "default-tenant",
      userId: "default-user",
    };

    const parsed = await parseDocumentContent(
      Buffer.from(testContent, "utf8"),
      "JERSEY.txt",
      metadata
    );

    console.log("Parsed sections:", parsed.sections);
  } catch (err) {
    console.error("Test error:", err);
  }
}

testPdf();
