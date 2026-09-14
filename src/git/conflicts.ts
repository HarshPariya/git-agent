import * as fs from "node:fs/promises";
import * as path from "node:path";
import { callLlm, isLlmAvailable } from "../llm/client.js";
import { safeExec, validateFilePath } from "./utils.js";

export interface ConflictMarker {
  readonly filePath: string;
  readonly ourLines: string[];
  readonly theirLines: string[];
  readonly baseLines: string[];
  readonly startLine: number;
  readonly endLine: number;
}

export interface ConflictFile {
  readonly filePath: string;
  readonly markers: readonly ConflictMarker[];
  readonly hasConflicts: boolean;
}

export interface ConflictResolution {
  readonly filePath: string;
  readonly resolvedContent: string;
  readonly strategy: "ours" | "theirs" | "merged" | "ai_semantic";
  readonly explanation: string;
  readonly confidence: number;
  readonly warnings: string[];
}

export interface ConflictAnalysis {
  readonly repositoryPath: string;
  readonly conflictFiles: readonly ConflictFile[];
  readonly mergeBase: string;
  readonly currentBranch: string;
  readonly incomingBranch: string;
  readonly totalConflicts: number;
  readonly resolutions: readonly ConflictResolution[];
  readonly analysisComplete: boolean;
}

const CONFLICT_LINE_PREFIXES = {
  start: "<<<<<<<",
  separator: "=======",
  base: "|||||||",
  end: ">>>>>>>",
} as const;

type ParseState = "idle" | "ours" | "base" | "theirs";

const runGitTrimmed = async (cmd: string, cwd: string): Promise<string> => {
  const { stdout } = await safeExec(cmd, cwd);
  return stdout.trim();
};

const CONFLICT_STATUS_PATTERN = /^(UU|AA|DD|AU|UA|DU|UD)\s/;

export class ConflictAnalyzer {
  async analyzeRepository(repositoryPath: string): Promise<ConflictAnalysis> {
    const [statusOutput, mergeBase, currentBranch] = await Promise.all([
      runGitTrimmed("git status --porcelain", repositoryPath),
      runGitTrimmed("git merge-base HEAD MERGE_HEAD 2>/dev/null || echo ''", repositoryPath),
      runGitTrimmed("git branch --show-current", repositoryPath),
    ]);

    const incomingBranch = await runGitTrimmed(
      "cat .git/MERGE_HEAD 2>/dev/null | head -c 8 || echo 'incoming'",
      repositoryPath,
    );
    const conflictFilePaths = statusOutput
      .split("\n")
      .filter((line) => CONFLICT_STATUS_PATTERN.test(line))
      .map((line) => line.slice(3).trim());

    const conflictFiles = await Promise.all(conflictFilePaths.map((fp) => this.analyzeFile(repositoryPath, fp)));
    const totalConflicts = conflictFiles.reduce((sum, f) => sum + f.markers.length, 0);

    const resolutions = await Promise.all(
      conflictFiles.filter((cf) => cf.hasConflicts).map((cf) => this.resolveFile(cf)),
    );

    return {
      repositoryPath,
      conflictFiles,
      mergeBase: mergeBase.slice(0, 8),
      currentBranch,
      incomingBranch: incomingBranch.slice(0, 8) || "incoming",
      totalConflicts,
      resolutions,
      analysisComplete: true,
    };
  }

  private async analyzeFile(repositoryPath: string, filePath: string): Promise<ConflictFile> {
    const content = await this.readFileContent(repositoryPath, filePath);
    const markers = this.parseConflictMarkers(filePath, content);
    return { filePath, markers, hasConflicts: markers.length > 0 };
  }

  private async readFileContent(repositoryPath: string, filePath: string): Promise<string> {
    try {
      return await fs.readFile(path.resolve(repositoryPath, filePath), "utf-8");
    } catch {
      const validatedPath = validateFilePath(filePath);
      const { stdout } = await safeExec(`git show :1:"${validatedPath}" 2>/dev/null || echo ''`, repositoryPath);
      return stdout;
    }
  }

  private parseConflictMarkers(filePath: string, content: string): ConflictMarker[] {
    const lines = content.split("\n");
    const markers: ConflictMarker[] = [];
    let state: ParseState = "idle";
    let startLine = 0;
    let ourLines: string[] = [];
    let baseLines: string[] = [];
    let theirLines: string[] = [];

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx] ?? "";

      if (line.startsWith(CONFLICT_LINE_PREFIXES.start)) {
        state = "ours";
        startLine = idx + 1;
        ourLines = [];
        baseLines = [];
        theirLines = [];
        continue;
      }

      if (state === "idle") continue;

      if (line.startsWith(CONFLICT_LINE_PREFIXES.base)) {
        state = "base";
        continue;
      }
      if (line.startsWith(CONFLICT_LINE_PREFIXES.separator)) {
        state = "theirs";
        continue;
      }

      if (line.startsWith(CONFLICT_LINE_PREFIXES.end)) {
        markers.push({
          filePath,
          ourLines: [...ourLines],
          theirLines: [...theirLines],
          baseLines: [...baseLines],
          startLine,
          endLine: idx + 1,
        });
        state = "idle";
        continue;
      }

      switch (state) {
        case "ours":
          ourLines.push(line);
          break;
        case "base":
          baseLines.push(line);
          break;
        case "theirs":
          theirLines.push(line);
          break;
      }
    }

    return markers;
  }

  async resolveFile(cf: ConflictFile): Promise<ConflictResolution> {
    return isLlmAvailable() ? this.resolveWithLlm(cf) : this.resolveDeterministic(cf);
  }

  private async resolveWithLlm(cf: ConflictFile): Promise<ConflictResolution> {
    try {
      const conflictBlocks = cf.markers
        .map(
          (m, i) =>
            `\n--- CONFLICT ${i + 1} (lines ${m.startLine}-${m.endLine}) ---\n` +
            `=== OUR CHANGES ===\n${m.ourLines.join("\n")}\n\n` +
            `=== BASE ===\n${m.baseLines.join("\n") || "(no base — new file conflict)"}\n\n` +
            `=== THEIR CHANGES ===\n${m.theirLines.join("\n")}`,
        )
        .join("\n");

      const response = await callLlm([
        { role: "system", content: "You are a merge conflict resolver. Output only valid JSON." },
        {
          role: "user",
          content:
            `Resolve merge conflict in ${cf.filePath} (${cf.markers.length} conflict(s)):\n${conflictBlocks}\n\n` +
            `Rules:\n1. Semantically merge both changes\n2. Preserve intent of BOTH sides\n` +
            `3. Respond in JSON:\n{"resolution":"...","strategy":"ai_semantic","explanation":"...","confidence":0.0-1.0,"warnings":[...]}`,
        },
      ]);

      const jsonMatch = /\{[\s\S]*\}/.exec(response.content);
      if (!jsonMatch) throw new Error("No JSON in response");

      const parsed = JSON.parse(jsonMatch[0]) as {
        resolution?: string;
        strategy?: ConflictResolution["strategy"];
        explanation?: string;
        confidence?: number;
        warnings?: string[];
      };
      return {
        filePath: cf.filePath,
        resolvedContent: parsed.resolution ?? "",
        strategy: parsed.strategy ?? "ai_semantic",
        explanation: parsed.explanation ?? "AI semantic merge applied.",
        confidence: parsed.confidence ?? 0.8,
        warnings: parsed.warnings ?? [],
      };
    } catch {
      return this.resolveDeterministic(cf);
    }
  }

  private resolveDeterministic(cf: ConflictFile): ConflictResolution {
    const resolvedLines = cf.markers.flatMap((m) => [
      ...m.ourLines,
      ...m.theirLines.filter((l) => !m.ourLines.includes(l)),
    ]);
    return {
      filePath: cf.filePath,
      resolvedContent: resolvedLines.join("\n"),
      strategy: "merged",
      explanation: "Deterministic merge: combined unique lines from both sides. Manual review recommended.",
      confidence: 0.5,
      warnings: [
        "LLM not available — manual review of this resolution is strongly recommended.",
        "Deterministic merge may not preserve semantic intent.",
      ],
    };
  }

  async applyResolution(
    repositoryPath: string,
    resolution: ConflictResolution,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await fs.writeFile(path.resolve(repositoryPath, resolution.filePath), resolution.resolvedContent, "utf-8");
      await safeExec(`git add "${validateFilePath(resolution.filePath)}"`, repositoryPath);
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async resolveAllConflicts(
    repositoryPath: string,
  ): Promise<{ success: boolean; analysis: ConflictAnalysis; appliedCount: number; errors: string[] }> {
    const analysis = await this.analyzeRepository(repositoryPath);
    const errors: string[] = [];
    let appliedCount = 0;

    for (const resolution of analysis.resolutions) {
      const result = await this.applyResolution(repositoryPath, resolution);
      if (result.success) {
        appliedCount++;
        continue;
      }
      if (result.error) errors.push(`${resolution.filePath}: ${result.error}`);
    }

    return { success: errors.length === 0, analysis, appliedCount, errors };
  }
}

export const conflictAnalyzer = new ConflictAnalyzer();
