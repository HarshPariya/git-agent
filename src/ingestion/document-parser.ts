import path from "node:path";
import { createRequire } from "node:module";
import { AppError } from "../errors/app-error.js";
import mammoth from "mammoth";
import { createCanvas } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const require = createRequire(import.meta.url);
const _rawPdfParse = require("pdf-parse");
const pdfParse =
  typeof _rawPdfParse === "function"
    ? _rawPdfParse
    : typeof _rawPdfParse?.default === "function"
    ? _rawPdfParse.default
    : _rawPdfParse?.PDFParse;

export interface DocumentSourceMetadata {
  readonly documentId: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly parserVersion?: string | undefined;
}

export interface ParsedDocumentSection {
  readonly pageNumber?: number | undefined;
  readonly section?: string | undefined;
  readonly content: string;
}

export interface TextQualityMetrics {
  readonly filename: string;
  readonly pageCount: number;
  readonly rawExtractedCharacters: number;
  readonly printableCharacterRatio: number;
  readonly alphabeticCharacterRatio: number;
  readonly replacementCharacterCount: number;
  readonly averageWordLength: number;
  readonly detectedTextQuality: "good" | "poor" | "unusable";
  readonly score: number;
}

export interface ParsedDocumentResult {
  readonly metadata: DocumentSourceMetadata;
  readonly sections: readonly ParsedDocumentSection[];
  readonly qualityMetrics?: TextQualityMetrics | undefined;
}

const SUPPORTED_EXTENSIONS = new Set([".pdf", ".docx", ".txt", ".md"]);
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB limit

export function validateDocumentFile(
  filename: string,
  sizeBytes: number,
): void {
  const ext = path.extname(filename).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new AppError(
      `Unsupported document format '${ext}'. Supported formats: .pdf, .docx, .txt, .md`,
      "VALIDATION_ERROR",
      400,
    );
  }
  if (sizeBytes > MAX_FILE_SIZE_BYTES) {
    throw new AppError(
      `Document size (${Math.round(sizeBytes / 1024)} KB) exceeds 50MB maximum limit.`,
      "VALIDATION_ERROR",
      400,
    );
  }
}

export function evaluateTextQuality(
  text: string,
  filename: string,
  pageCount: number = 1,
): TextQualityMetrics {
  const totalLength = text.length;

  if (totalLength === 0) {
    return {
      filename,
      pageCount,
      rawExtractedCharacters: 0,
      printableCharacterRatio: 0,
      alphabeticCharacterRatio: 0,
      replacementCharacterCount: 0,
      averageWordLength: 0,
      detectedTextQuality: "unusable",
      score: 0,
    };
  }

  let printableCount = 0;
  let alphaCount = 0;
  let replacementCount = 0;

  for (let i = 0; i < totalLength; i++) {
    const code = text.charCodeAt(i);
    const char = text[i];

    if ((code >= 32 && code <= 126) || code === 10 || code === 13 || code === 9) {
      printableCount++;
    }
    if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57)) {
      alphaCount++;
    }
    if (char === "\uFFFD" || code === 0) {
      replacementCount++;
    }
  }

  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const totalWordChars = words.reduce((acc, w) => acc + w.length, 0);
  const averageWordLength = words.length > 0 ? totalWordChars / words.length : 0;

  const printableCharacterRatio = printableCount / totalLength;
  const alphabeticCharacterRatio = alphaCount / totalLength;

  let score = 0;
  score += printableCharacterRatio * 0.4;
  score += Math.min(1.0, alphabeticCharacterRatio * 1.5) * 0.4;

  if (averageWordLength >= 2 && averageWordLength <= 12) {
    score += 0.2;
  } else if (averageWordLength > 12) {
    score -= 0.2;
  }

  if (replacementCount > 10) {
    score -= 0.3;
  }

  score = Math.max(0, Math.min(1.0, score));

  let detectedTextQuality: "good" | "poor" | "unusable" = "unusable";
  if (score >= 0.55 && words.length >= 3) {
    detectedTextQuality = "good";
  } else if (score >= 0.25 && words.length >= 1) {
    detectedTextQuality = "poor";
  } else {
    detectedTextQuality = "unusable";
  }

  return {
    filename,
    pageCount,
    rawExtractedCharacters: totalLength,
    printableCharacterRatio: Number(printableCharacterRatio.toFixed(3)),
    alphabeticCharacterRatio: Number(alphabeticCharacterRatio.toFixed(3)),
    replacementCharacterCount: replacementCount,
    averageWordLength: Number(averageWordLength.toFixed(1)),
    detectedTextQuality,
    score: Number(score.toFixed(2)),
  };
}

export function normalizeExtractedText(text: string): string {
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\b([a-zA-Z]+)\s*-\s*\n\s*([a-zA-Z]+)\b/g, "$1$2")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface PageText {
  pageNumber: number;
  text: string;
}

async function extractPdfNative(
  buffer: Buffer,
): Promise<{ pages: PageText[]; totalPages: number }> {
  const pages: PageText[] = [];

  const data = await pdfParse(buffer, {
    pagerender: (pageData: any) => {
      return pageData.getTextContent().then((textContent: any) => {
        let lastY: number | null = null;
        let pageStr = "";
        for (const item of textContent.items) {
          if (lastY === null || Math.abs(lastY - item.transform[5]) > 5) {
            pageStr += "\n" + item.str;
          } else {
            pageStr += " " + item.str;
          }
          lastY = item.transform[5];
        }
        const cleaned = pageStr.trim();
        if (cleaned.length > 0) {
          pages.push({
            pageNumber: pageData.pageIndex + 1,
            text: cleaned,
          });
        }
        return pageStr;
      });
    },
  });

  const totalPages = data.numpages || pages.length || 1;
  const resultPages =
    pages.length > 0
      ? pages
      : data.text && data.text.trim().length > 0
      ? [{ pageNumber: 1, text: data.text.trim() }]
      : [];

  return { pages: resultPages, totalPages };
}

async function loadPdfJsDocument(buffer: Buffer): Promise<any> {
  return pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableFontFace: false,
  }).promise;
}

async function extractPdfAlternate(
  buffer: Buffer,
): Promise<{ pages: PageText[]; totalPages: number }> {
  const document = await loadPdfJsDocument(buffer);
  const pages: PageText[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
    const page = await document.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map((item: any) => `${item.str ?? ""}${item.hasEOL ? "\n" : " "}`)
      .join("")
      .trim();
    if (text) pages.push({ pageNumber, text });
  }

  return { pages, totalPages: document.numPages };
}

async function extractPdfWithOcr(
  buffer: Buffer,
): Promise<{ pages: PageText[]; totalPages: number }> {
  const tesseractModule = await import("tesseract.js");
  const tesseract = tesseractModule.default;
  const document = await loadPdfJsDocument(buffer);
  const pages: PageText[] = [];
  const worker = await tesseract.createWorker("eng", tesseract.OEM.LSTM_ONLY, {
    cachePath: path.join(process.cwd(), ".cache", "tesseract"),
  });

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");
      await page.render({ canvasContext: context as any, viewport }).promise;
      const image = await canvas.encode("png");
      const result = await worker.recognize(image);
      const text = result.data.text.trim();
      if (text) pages.push({ pageNumber, text });
    }
  } finally {
    await worker.terminate();
  }

  return { pages, totalPages: document.numPages };
}

function buildPdfResult(
  pages: readonly PageText[],
  totalPages: number,
  filename: string,
  metadata: DocumentSourceMetadata,
  parserVersion: string,
): ParsedDocumentResult | undefined {
  const fullText = pages.map((page) => page.text).join("\n\n");
  const qualityMetrics = evaluateTextQuality(fullText, filename, totalPages);
  if (qualityMetrics.detectedTextQuality !== "good" || pages.length === 0) return undefined;

  return {
    metadata: { ...metadata, parserVersion },
    sections: pages
      .map((page) => ({
        pageNumber: page.pageNumber,
        section: `Page ${page.pageNumber}`,
        content: normalizeExtractedText(page.text),
      }))
      .filter((section) => section.content.length > 0),
    qualityMetrics,
  };
}

async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value.replace(/\s+/g, " ").trim();
}

export async function parseDocumentContent(
  buffer: Buffer,
  filename: string,
  metadata: DocumentSourceMetadata,
): Promise<ParsedDocumentResult> {
  validateDocumentFile(filename, buffer.length);
  const ext = path.extname(filename).toLowerCase();

  switch (ext) {
    case ".txt":
    case ".md": {
      const text = buffer.toString("utf8");
      const normalized = normalizeExtractedText(text);
      const qualityMetrics = evaluateTextQuality(normalized, filename, 1);

      if (qualityMetrics.detectedTextQuality === "unusable") {
        throw new AppError(
          `Unable to extract readable text from '${filename}'. Document content is unreadable or empty.`,
          "EXTRACTION_FAILED",
          422,
        );
      }

      const lines = normalized.split(/\n{2,}/);
      const sections: ParsedDocumentSection[] = lines
        .map((paragraph, index) => ({
          pageNumber: 1,
          section: `Section ${index + 1}`,
          content: paragraph.trim(),
        }))
        .filter((s) => s.content.length > 0);

      return {
        metadata: {
          ...metadata,
          parserVersion: "document-parser-v2",
        },
        sections: sections.length > 0 ? sections : [{ pageNumber: 1, section: "Section 1", content: normalized }],
        qualityMetrics,
      };
    }

    case ".pdf": {
      const failures: string[] = [];

      try {
        const { pages, totalPages } = await extractPdfNative(buffer);
        const nativeResult = buildPdfResult(
          pages, totalPages, filename, metadata, "document-parser-v3-native",
        );
        if (nativeResult) return nativeResult;
        failures.push("native extraction did not pass the quality gate");
      } catch (err: any) {
        failures.push(`native extraction: ${err?.message || err}`);
      }

      try {
        const { pages, totalPages } = await extractPdfAlternate(buffer);
        const alternateResult = buildPdfResult(
          pages, totalPages, filename, metadata, "document-parser-v3-pdfjs",
        );
        if (alternateResult) return alternateResult;
        failures.push("alternate extraction did not pass the quality gate");
      } catch (err: any) {
        failures.push(`alternate extraction: ${err?.message || err}`);
      }

      try {
        console.log(`[DOCUMENT OCR] Text extraction was insufficient; running OCR for ${filename}.`);
        const { pages, totalPages } = await extractPdfWithOcr(buffer);
        const ocrResult = buildPdfResult(
          pages, totalPages, filename, metadata, "document-parser-v3-ocr",
        );
        if (ocrResult) return ocrResult;
        failures.push("OCR output did not pass the quality gate");
      } catch (err: any) {
        failures.push(`OCR: ${err?.message || err}`);
      }

      console.error(`[DOCUMENT EXTRACTION FAILED] ${filename}: ${failures.join("; ")}`);
      throw new AppError(
        `Unable to extract readable text from PDF '${filename}' after native, alternate, and OCR extraction.`,
        "EXTRACTION_FAILED",
        422,
      );
    }

    case ".docx": {
      const docxText = await extractDocxText(buffer);
      const normalized = normalizeExtractedText(docxText);
      const qualityMetrics = evaluateTextQuality(normalized, filename, 1);

      if (qualityMetrics.detectedTextQuality === "unusable") {
        throw new AppError(
          `Unable to extract readable text from DOCX '${filename}'.`,
          "EXTRACTION_FAILED",
          422,
        );
      }

      return {
        metadata: {
          ...metadata,
          parserVersion: "document-parser-v2",
        },
        sections: [{ pageNumber: 1, section: "Document Content", content: normalized }],
        qualityMetrics,
      };
    }

    default:
      throw new AppError(`Unsupported document extension: ${ext}`, "VALIDATION_ERROR", 400);
  }
}
