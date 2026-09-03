export type CodeQueryIntent =
  | "FILE_LOCATION"
  | "FILE_CONTENT"
  | "LINE_RANGE"
  | "SYMBOL_LIST"
  | "SYMBOL_LOCATION"
  | "RELATIONSHIP"
  | "CODE_EXPLANATION"
  | "EXECUTION_TRACE"
  | "CALLER_SEARCH"
  | "IMPACT_ANALYSIS"
  | "REPAIR_REQUEST"
  | "DOCUMENT_PIPELINE"
  | "ARCHITECTURE_TRACE"
  | "OTHER";

export interface CodeQueryAnalysis {
  readonly intent: CodeQueryIntent;
  readonly filenames: readonly string[];
  readonly symbol?: string | undefined;
  readonly symbols: readonly string[];
  readonly startLine?: number | undefined;
  readonly endLine?: number | undefined;
  readonly lastLines?: number | undefined;
}

const FILENAME_PATTERN = /\b[a-zA-Z0-9_$-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|html|css|yml|yaml|py|txt|sh|sql|toml|rs|go|java|cpp|c|h)\b/g;

const unique = (values: readonly string[]): string[] =>
  [...new Set(values.map((value) => value.toLowerCase()))];

const uniqueSymbols = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export function analyzeCodeQuery(query: string): CodeQueryAnalysis {
  const normalized = query.trim();
  const lower = normalized.toLowerCase();

  // If the query is an active modification, creation, or deletion command,
  // route it to the Agent autonomous tool execution loop rather than static inspection.
  if (
    /\b(?:make|create|write|save|generate|touch|edit|modify|update|delete|remove|erase|unlink|append|insert|add|replace|change|fix|patch)\b/i.test(lower) &&
    !/\b(?:where\s+is|who\s+calls|find\s+callers|explain\s+how|walk\s+me\s+through)\b/i.test(lower)
  ) {
    return { intent: "OTHER", filenames: [], symbols: [] };
  }

  const filenames = unique(normalized.match(FILENAME_PATTERN) ?? []);
  const symbols = uniqueSymbols(
    normalized.match(/\b(?:[A-Z][A-Za-z0-9_$]{2,}|[a-z][a-z0-9_$]*[A-Z][A-Za-z0-9_$]*)\b/g) ?? [],
  ).filter((symbol) => !["show", "trace", "explain", "where", "what"].includes(symbol.toLowerCase()));
  let startLine: number | undefined;
  let endLine: number | undefined;
  let lastLines: number | undefined;

  const rangeMatch = /(?:lines?|from\s+line)\s+(\d+)\s*(?:-|–|—|to|through|\.\.)\s*(?:line\s+)?(\d+)\b/i.exec(normalized);
  if (rangeMatch) {
    startLine = Number(rangeMatch[1]);
    endLine = Number(rangeMatch[2]);
  } else {
    const firstNMatch =
      /(?:first|top|initial|only|give\s+(?:me\s+)?(?:the\s+)?first|give\s+(?:me\s+)?|show\s+(?:me\s+)?(?:the\s+)?first|show\s+(?:me\s+)?)\s+(\d+)\s+lines?\b/i.exec(normalized) ??
      /(?:first|top|initial)\s+(\d+)\b/i.exec(normalized);
    if (firstNMatch) {
      startLine = 1;
      endLine = Number(firstNMatch[1]);
    } else {
      const lastNMatch = /(?:last|bottom|tail|end)\s+(\d+)\s+lines?\b/i.exec(normalized);
      if (lastNMatch) {
        lastLines = Number(lastNMatch[1]);
      }
    }
  }

  const impactSymbol = /^\/impact\s+([A-Za-z_$][\w$]*)\s*$/i.exec(normalized)?.[1];
  if (impactSymbol) {
    return { intent: "IMPACT_ANALYSIS", filenames, symbols, symbol: impactSymbol };
  }

  if (
    filenames.length > 0 &&
    /\b(?:error|bug|broken|fix|solve|repair)\b/i.test(lower)
  ) {
    return { intent: "REPAIR_REQUEST", filenames, symbols };
  }

  if (filenames.length > 0 && ((startLine !== undefined && endLine !== undefined && !isNaN(startLine) && !isNaN(endLine)) || (lastLines !== undefined && !isNaN(lastLines)))) {
    return {
      intent: "LINE_RANGE",
      filenames,
      symbols,
      ...(startLine !== undefined && { startLine }),
      ...(endLine !== undefined && { endLine }),
      ...(lastLines !== undefined && { lastLines }),
    };
  }

  if (
    /(?:\b(?:architecture|architectural|end-to-end)\b|\/api\/chat)/i.test(lower) &&
    /\b(?:trace|flow|pipeline|execution)\b/i.test(lower)
  ) {
    return { intent: "ARCHITECTURE_TRACE", filenames, symbols };
  }

  if (
    /\buploaded?[-\s]+document\b/i.test(lower) &&
    /\b(?:pipeline|flow|goes|upload|parse|chunk|index|retriev)\w*\b/i.test(lower)
  ) {
    return { intent: "DOCUMENT_PIPELINE", filenames, symbols };
  }

  if (
    /\bgraph\s*search\b/i.test(lower) &&
    /\b(?:how|work|works|explain|describe|implementation)\b/i.test(lower)
  ) {
    return {
      intent: "CODE_EXPLANATION",
      filenames: ["graph-search.ts"],
      symbols,
    };
  }

  const directUsageSymbol = /\bwhere\s+is\s+([A-Za-z_$][\w$]*)\s+(?:used|called|referenced|invoked)\b/i.exec(normalized)?.[1];
  const definitionAndUsageSymbol = /\bwhere\s+is\s+([A-Za-z_$][\w$]*)\s+(?:implemented|defined|declared|located)\b/i.exec(normalized)?.[1];
  const componentsCallingSymbol = /\b(?:which\s+components?\s+call|find\s+(?:every|all)\s+(?:runtime\s+)?callers?\s+of)\s+([A-Za-z_$][\w$]*)\b/i.exec(normalized)?.[1];
  const callerSymbol = directUsageSymbol ?? definitionAndUsageSymbol ?? componentsCallingSymbol;
  if (
    callerSymbol &&
    (Boolean(directUsageSymbol) || /\b(?:callers?|calls?|called|uses?|usages?|references?|components?)\b/i.test(lower))
  ) {
    return { intent: "CALLER_SEARCH", filenames, symbols, symbol: callerSymbol };
  }

  if (/\b(?:trace|execution\s+flow|call\s+flow|flow\s+from)\b/i.test(lower)) {
    return { intent: "EXECUTION_TRACE", filenames, symbols };
  }

  if (
    filenames.length >= 2 &&
    /\b(?:relationship|related|relate|connection|connect|dependency|depend|interact|between)\b/i.test(lower)
  ) {
    return { intent: "RELATIONSHIP", filenames, symbols };
  }

  if (
    filenames.length > 0 &&
    /\b(?:explain|how does|how is|what does|walk me through|describe)\b/i.test(lower)
  ) {
    return { intent: "CODE_EXPLANATION", filenames, symbols };
  }

  if (
    filenames.length > 0 &&
    /\b(?:what|which|list|show|give)\b[\s\S]*\b(?:functions?|classes?|interfaces?|methods?|symbols?|types?)\b|\b(?:functions?|classes?|interfaces?|methods?|symbols?|types?)\b[\s\S]*\b(?:defined|declared|in)\b/i.test(lower)
  ) {
    return { intent: "SYMBOL_LIST", filenames, symbols };
  }

  const symbolLocation = /\bwhere\s+is\s+([a-zA-Z_$][\w$]*)\s+(?:implemented|defined|declared|located)\b/i.exec(normalized);
  if (symbolLocation?.[1] && filenames.length === 0) {
    return { intent: "SYMBOL_LOCATION", filenames, symbols, symbol: symbolLocation[1] };
  }

  if (
    filenames.length > 0 &&
    /\b(?:where|find|locate|location|path)\b/i.test(lower) &&
    !/\b(?:show|read|contents?|explain|works?|functions?|classes?|relationship|related)\b/i.test(lower)
  ) {
    return { intent: "FILE_LOCATION", filenames, symbols };
  }

  if (
    filenames.length > 0 &&
    /\b(?:do|does)\s+(?:this\s+)?(?:project|repo|repository|we)\s+have\b|\b(?:we|project|repo|repository)\s+have\b|\b(?:is|are)\s+there\b|\b(?:exists?|available|present)\b/i.test(lower)
  ) {
    return { intent: "FILE_LOCATION", filenames, symbols };
  }

  if (
    filenames.length > 0 &&
    !/\b(?:write|create|make|add|insert|append|generate|edit|modify|update|replace|change|delete|remove|fix|patch)\b/i.test(lower) &&
    (/\b(?:show|read|display|open|contents?|source)\b/i.test(lower) ||
      /\bwhat\s+is\s+in\b/i.test(lower) ||
      /\bwhat\s+is\s+(?:the\s+)?code\b/i.test(lower) ||
      /\btell\s+me\s+about\b/i.test(lower))
  ) {
    return { intent: "FILE_CONTENT", filenames, symbols };
  }

  return { intent: "OTHER", filenames, symbols };
}

export function extractDeclaredSymbols(content: string): readonly string[] {
  const symbols = new Set<string>();
  const patterns = [
    /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm,
    /^(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/gm,
    /^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/gm,
    /^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/gm,
    /^export\s+const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=/gm,
    /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/gm,
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      if (match[1]) symbols.add(match[1]);
    }
  }
  return [...symbols];
}
