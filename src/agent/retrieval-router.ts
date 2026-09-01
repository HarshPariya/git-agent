export type RetrievalMode = "code" | "document" | "mixed" | "general" | "system";

export interface RouteRequest {
  readonly query: string;
  readonly hasUploadedDocuments?: boolean | undefined;
  readonly documentIds?: readonly string[] | undefined;
}

export interface RouteResult {
  readonly mode: RetrievalMode;
  readonly confidence: number;
  readonly reason: string;
}

const CODE_KEYWORDS = [
  "code", "file", "function", "class", "method", "variable", "src/", "public/",
  "import", "export", "interface", "type", "ast", "repo", "repository", "folder",
  "implementation", "handler", "route", "endpoint", "where is", "how does",
  "architecture", "archtecture", "architect", "design", "structure", "overview",
  "readme", "create", "write", "generate", "make", "edit", "modify", "delete",
  "git", "system design", ".md", ".ts", ".js", ".json",
];

const DOCUMENT_KEYWORDS = [
  "document", "pdf", "docx", "policy", "spec", "specification", "uploaded",
  "manual", "guideline", "requirement", "leave", "contract", "report", "file uploaded",
];

const SYSTEM_PATTERNS = [
  "request logs", "check logs", "system logs", "application logs", "/metrics",
  "system sla", "health check", "system health", "observability", "runtime status",
];

const GENERAL_PATTERNS = [
  "what is rag", "define rag", "explain rag",
];
const GENERAL_EXACT = new Set(["hello", "hi", "hey", "thank you", "thanks"]);

const DOCUMENT_FOLLOWUP_PATTERNS = [
  "jersey", "captain", "team train", "position", "player", "prajapati", "rishabh",
  "what about his", "what about her", "in the document", "according to the document",
];

export function routeQuery({
  query,
  hasUploadedDocuments = false,
}: RouteRequest): RouteResult {
  const normalized = query.toLowerCase().trim();

  const matchesCode = CODE_KEYWORDS.some((kw) => normalized.includes(kw));
  const matchesDocument = DOCUMENT_KEYWORDS.some((kw) => normalized.includes(kw));

  if (SYSTEM_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return { mode: "system", confidence: 0.99, reason: "Explicit system or observability request." };
  }

  if (GENERAL_EXACT.has(normalized.replace(/[!?.,]/g, "")) || GENERAL_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return { mode: "general", confidence: 0.98, reason: "General conceptual question." };
  }

  if (matchesCode && matchesDocument && hasUploadedDocuments) {
    return {
      mode: "mixed",
      confidence: 0.9,
      reason: "Query references both code structure and uploaded document requirements.",
    };
  }

  if (matchesDocument && hasUploadedDocuments) {
    return {
      mode: "document",
      confidence: 0.95,
      reason: "Query targets uploaded documentation.",
    };
  }

  if (matchesCode) {
    return {
      mode: "code",
      confidence: 0.9,
      reason: "Query targets codebase structure or implementation.",
    };
  }

  const isShortEntityLookup = /^[A-Z0-9][A-Z0-9_-]{2,}$/.test(query.trim());
  if (
    hasUploadedDocuments &&
    (DOCUMENT_FOLLOWUP_PATTERNS.some((pattern) => normalized.includes(pattern)) || isShortEntityLookup)
  ) {
    return {
      mode: "document",
      confidence: 0.85,
      reason: "Query is a document fact lookup or contextual document follow-up.",
    };
  }

  return {
    mode: "general",
    confidence: 0.8,
    reason: "General question.",
  };
}
