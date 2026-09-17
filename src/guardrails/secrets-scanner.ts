export interface SecretScanMatch {
  readonly rule: string;
  readonly file?: string | undefined;
  readonly line?: number;
  readonly snippet: string;
}

export interface SecretScanResult {
  readonly clean: boolean;
  readonly matches: readonly SecretScanMatch[];
}

const SENSITIVE_FILE_PATTERNS = [
  /(?:^|[\\/])\.env(?:\..+)?$/i,
  /(?:^|[\\/])credentials\.json$/i,
  /(?:^|[\\/])service_account.*\.json$/i,
  /(?:^|[\\/])id_rsa(?:.*)?$/i,
  /(?:^|[\\/])id_ed25519(?:.*)?$/i,
  /\.(?:pem|key|pkcs12|pfx|kdbx)$/i,
  /(?:^|[\\/])token\.json$/i,
  /(?:^|[\\/])auth\.json$/i,
];

const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "AWS Access Key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "GitHub Personal Access Token", pattern: /\bgh[pousr]_[A-Za-z0-9_]{36,}\b/g },
  { name: "GitHub Fine-Grained Token", pattern: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g },
  { name: "Google API Key", pattern: /\bAIza[0-9A-Za-z-_]{35}\b/g },
  { name: "Slack Token", pattern: /\bxox[baprs]-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{24,}\b/g },
  { name: "Private Key", pattern: /-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY-----/g },
  {
    name: "Generic High-Entropy Secret",
    pattern: /(?:api[_-]?key|secret[_-]?key|auth[_-]?token|private[_-]?token)\s*[:=]\s*["'][A-Za-z0-9+/=_-]{20,}["']/gi,
  },
];

export function isSensitiveFilePath(filePath: string): boolean {
  if (!filePath) return false;
  const normalized = filePath.replace(/\\/g, "/");
  return SENSITIVE_FILE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function redactSecrets(content: string): string {
  let result = content;
  for (const { pattern } of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, "[REDACTED_SECRET]");
  }
  return result;
}

export function scanContentForSecrets(content: string, filePath?: string): SecretScanResult {
  const matches: SecretScanMatch[] = [];

  // Check file path first
  if (filePath && isSensitiveFilePath(filePath)) {
    matches.push({
      rule: "Potential Secret File",
      file: filePath,
      line: 1,
      snippet: `Potential secret or credential file detected: ${filePath}. Do not commit secrets.`,
    });
  }

  const lines = content.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex] ?? "";
    for (const { name, pattern } of SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        // Redact match for security display - NEVER display raw secret
        const safeRedacted = redactSecrets(line);
        const snippet = safeRedacted.length > 80 ? safeRedacted.slice(0, 77) + "..." : safeRedacted;
        matches.push({
          rule: name,
          file: filePath,
          line: lineIndex + 1,
          snippet: snippet.trim(),
        });
      }
    }
  }

  return {
    clean: matches.length === 0,
    matches,
  };
}
