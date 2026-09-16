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

export function scanContentForSecrets(content: string, filePath?: string): SecretScanResult {
  const matches: SecretScanMatch[] = [];
  const lines = content.split(/\r?\n/);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex] ?? "";
    for (const { name, pattern } of SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        // Redact match for security display
        const redacted = line.length > 80 ? line.slice(0, 77) + "..." : line;
        matches.push({
          rule: name,
          file: filePath,
          line: lineIndex + 1,
          snippet: redacted.trim(),
        });
      }
    }
  }

  return {
    clean: matches.length === 0,
    matches,
  };
}
