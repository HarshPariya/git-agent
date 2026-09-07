/**
 * Merge Conflict Analyzer & Resolver
 * Performs 3-way merge conflict analysis and Groq-powered semantic resolution
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { callLlm, isLlmAvailable } from "../llm/client.js";

const execAsync = promisify(exec);

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

const safeExec = async (cmd: string, cwd: string): Promise<string> => {
  try {
    const { stdout } = await execAsync(cmd, { cwd, timeout: 30_000 });
    return stdout.trim();
  } catch {
    return "";
  }
};

export class ConflictAnalyzer {
  async analyzeRepository(repositoryPath: string): Promise<ConflictAnalysis> {
    const [statusOutput, mergeBase, currentBranch] = await Promise.all([
      safeExec("git status --porcelain", repositoryPath),
      safeExec("git merge-base HEAD MERGE_HEAD 2>/dev/null || echo ''", repositoryPath),
      safeExec("git branch --show-current", repositoryPath),
    ]);

    const incomingBranch = await safeExec(
      "cat .git/MERGE_HEAD 2>/dev/null | head -c 8 || echo 'incoming'",
      repositoryPath,
    );

    // Find conflict files (UU, AA, DD status codes)
    const conflictFilePaths = statusOutput
      .split("\n")
      .filter((line) => line.match(/^(UU|AA|DD|AU|UA|DU|UD)\s/))
      .map((line) => line.slice(3).trim());

    const conflictFiles: ConflictFile[] = [];
    for (const fp of conflictFilePaths) {
      const fileAnalysis = await this.analyzeFile(repositoryPath, fp);
      conflictFiles.push(fileAnalysis);
    }

    const totalConflicts = conflictFiles.reduce((sum, f) => sum + f.markers.length, 0);

    // Generate resolutions
    const resolutions: ConflictResolution[] = [];
    for (const cf of conflictFiles) {
      if (cf.hasConflicts) {
        const resolution = await this.resolveFile(repositoryPath, cf);
        resolutions.push(resolution);
      }
    }

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

  private async analyzeFile(
    repositoryPath: string,
    filePath: string,
  ): Promise<ConflictFile> {
    let content = "";
    try {
      const fullPath = path.resolve(repositoryPath, filePath);
      content = await fs.readFile(fullPath, "utf-8");
    } catch {
      content = await safeExec(`git show :1:"${filePath}" 2>/dev/null || echo ''`, repositoryPath);
    }
    const markers = this.parseConflictMarkers(filePath, content);
    return {
      filePath,
      markers,
      hasConflicts: markers.length > 0,
    };
  }

  private parseConflictMarkers(filePath: string, content: string): ConflictMarker[] {
    const lines = content.split("\n");
    const markers: ConflictMarker[] = [];

    let inConflict = false;
    let inOurs = false;
    let inBase = false;
    let inTheirs = false;
    let startLine = 0;
    let ourLines: string[] = [];
    let baseLines: string[] = [];
    let theirLines: string[] = [];

    lines.forEach((line, idx) => {
      if (line.startsWith("<<<<<<<")) {
        inConflict = true;
        inOurs = true;
        startLine = idx + 1;
        ourLines = [];
        baseLines = [];
        theirLines = [];
      } else if (line.startsWith("|||||||") && inConflict) {
        inOurs = false;
        inBase = true;
        inTheirs = false;
      } else if (line.startsWith("=======") && inConflict) {
        inOurs = false;
        inBase = false;
        inTheirs = true;
      } else if (line.startsWith(">>>>>>>") && inConflict) {
        markers.push({
          filePath,
          ourLines: [...ourLines],
          theirLines: [...theirLines],
          baseLines: [...baseLines],
          startLine,
          endLine: idx + 1,
        });
        inConflict = false;
        inOurs = false;
        inBase = false;
        inTheirs = false;
      } else if (inConflict) {
        if (inOurs) ourLines.push(line);
        else if (inBase) baseLines.push(line);
        else if (inTheirs) theirLines.push(line);
      }
    });

    return markers;
  }

  public async resolveFile(
    repositoryPath: string,
    cf: ConflictFile,
  ): Promise<ConflictResolution> {
    if (!isLlmAvailable()) {
      return this.resolveDeterministic(repositoryPath, cf);
    }

    return this.resolveWithLlm(repositoryPath, cf);
  }

  private async resolveWithLlm(
    _repositoryPath: string,
    cf: ConflictFile,
  ): Promise<ConflictResolution> {
    const prompt = `You are a senior software engineer resolving a merge conflict.

FILE: ${cf.filePath}

CONFLICTS TO RESOLVE (${cf.markers.length} conflict(s)):

${cf.markers
        .map(
          (m, i) => `
--- CONFLICT ${i + 1} (lines ${m.startLine}-${m.endLine}) ---
=== OUR CHANGES (current branch) ===
${m.ourLines.join("\n")}

=== BASE (common ancestor) ===
${m.baseLines.join("\n") || "(no base — new file conflict)"}

=== THEIR CHANGES (incoming branch) ===
${m.theirLines.join("\n")}
`,
        )
        .join("\n")}

Rules:
1. DO NOT blindly choose "ours" or "theirs" — semantically merge both changes
2. Preserve the intent of BOTH sides
3. If one side adds null-safety and the other adds a feature, include both
4. Respond in JSON:
{
  "resolution": "COMPLETE resolved code for this file (no conflict markers)",
  "strategy": "ai_semantic",
  "explanation": "Why this resolution is correct",
  "confidence": 0.0-1.0,
  "warnings": ["Any risks or warnings"]
}`;

    try {
      const response = await callLlm([
        { role: "system", content: "You are a merge conflict resolver. Output only valid JSON." },
        { role: "user", content: prompt },
      ]);

      const jsonMatch = /\{[\s\S]*\}/.exec(response.content);
      if (!jsonMatch) throw new Error("No JSON");

      const parsed = JSON.parse(jsonMatch[0]) as {
        resolution?: string;
        strategy?: "ours" | "theirs" | "merged" | "ai_semantic";
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
      return this.resolveDeterministic(_repositoryPath, cf);
    }
  }

  private resolveDeterministic(
    _repositoryPath: string,
    cf: ConflictFile,
  ): ConflictResolution {
    // Default: prefer theirs (incoming) as a safe fallback when LLM not available
    const resolvedLines: string[] = [];
    for (const marker of cf.markers) {
      // Attempt to merge: take ours + theirs unique lines
      const combined = [
        ...marker.ourLines,
        ...marker.theirLines.filter((l) => !marker.ourLines.includes(l)),
      ];
      resolvedLines.push(...combined);
    }

    return {
      filePath: cf.filePath,
      resolvedContent: resolvedLines.join("\n"),
      strategy: "merged",
      explanation:
        "Deterministic merge: combined unique lines from both sides. Manual review recommended.",
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
      const fullPath = path.resolve(repositoryPath, resolution.filePath);
      await fs.writeFile(fullPath, resolution.resolvedContent, "utf-8");
      await execAsync(`git add "${resolution.filePath}"`, { cwd: repositoryPath });
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async resolveAllConflicts(
    repositoryPath: string,
  ): Promise<{
    success: boolean;
    analysis: ConflictAnalysis;
    appliedCount: number;
    errors: string[];
  }> {
    const analysis = await this.analyzeRepository(repositoryPath);
    const errors: string[] = [];
    let appliedCount = 0;

    for (const resolution of analysis.resolutions) {
      const result = await this.applyResolution(repositoryPath, resolution);
      if (result.success) {
        appliedCount++;
      } else if (result.error) {
        errors.push(`${resolution.filePath}: ${result.error}`);
      }
    }

    return {
      success: errors.length === 0,
      analysis,
      appliedCount,
      errors,
    };
  }
}

export const conflictAnalyzer = new ConflictAnalyzer();
