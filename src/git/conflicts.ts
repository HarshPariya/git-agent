import * as fs from "node:fs/promises";
import * as path from "node:path";
import { callLlm, isLlmAvailable } from "../llm/client.js";
import { safeExec, validateFilePath } from "./utils.js";

export interface ConflictMarker { readonly filePath: string; readonly ourLines: string[]; readonly theirLines: string[]; readonly baseLines: string[]; readonly startLine: number; readonly endLine: number; }
export interface ConflictFile { readonly filePath: string; readonly markers: readonly ConflictMarker[]; readonly hasConflicts: boolean; }
export interface ConflictResolution { readonly filePath: string; readonly resolvedContent: string; readonly strategy: "ours" | "theirs" | "merged" | "ai_semantic"; readonly explanation: string; readonly confidence: number; readonly warnings: string[]; }
export interface ConflictAnalysis { readonly repositoryPath: string; readonly conflictFiles: readonly ConflictFile[]; readonly mergeBase: string; readonly currentBranch: string; readonly incomingBranch: string; readonly totalConflicts: number; readonly resolutions: readonly ConflictResolution[]; readonly analysisComplete: boolean; }

const safeExecTrimmed = async (cmd: string, cwd: string): Promise<string> => {
  const result = await safeExec(cmd, cwd);
  return result.stdout.trim();
};

export class ConflictAnalyzer {
  async analyzeRepository(repositoryPath: string): Promise<ConflictAnalysis> {
    const [statusOutput, mergeBase, currentBranch] = await Promise.all([
      safeExecTrimmed("git status --porcelain", repositoryPath),
      safeExecTrimmed("git merge-base HEAD MERGE_HEAD 2>/dev/null || echo ''", repositoryPath),
      safeExecTrimmed("git branch --show-current", repositoryPath),
    ]);
    const incomingBranch = await safeExecTrimmed("cat .git/MERGE_HEAD 2>/dev/null | head -c 8 || echo 'incoming'", repositoryPath);
    const conflictFilePaths = statusOutput.split("\n").filter((line: string) => /^(UU|AA|DD|AU|UA|DU|UD)\s/.test(line)).map((line: string) => line.slice(3).trim());
    const conflictFiles: ConflictFile[] = [];
    for (const fp of conflictFilePaths) { conflictFiles.push(await this.analyzeFile(repositoryPath, fp)); }
    const totalConflicts = conflictFiles.reduce((sum, f) => sum + f.markers.length, 0);
    const resolutions: ConflictResolution[] = [];
    for (const cf of conflictFiles) { if (cf.hasConflicts) resolutions.push(await this.resolveFile(repositoryPath, cf)); }
    return { repositoryPath, conflictFiles, mergeBase: mergeBase.slice(0, 8), currentBranch, incomingBranch: incomingBranch.slice(0, 8) || "incoming", totalConflicts, resolutions, analysisComplete: true };
  }

  private async analyzeFile(repositoryPath: string, filePath: string): Promise<ConflictFile> {
    let content = "";
    try {
      content = await fs.readFile(path.resolve(repositoryPath, filePath), "utf-8");
    } catch {
      const validatedPath = validateFilePath(filePath);
      const { stdout } = await safeExec(`git show :1:"${validatedPath}" 2>/dev/null || echo ''`, repositoryPath);
      content = stdout;
    }
    const markers = this.parseConflictMarkers(filePath, content);
    return { filePath, markers, hasConflicts: markers.length > 0 };
  }

  private parseConflictMarkers(filePath: string, content: string): ConflictMarker[] {
    const lines = content.split("\n");
    const markers: ConflictMarker[] = [];
    let inConflict = false, inOurs = false, inBase = false, inTheirs = false, startLine = 0;
    let ourLines: string[] = [], baseLines: string[] = [], theirLines: string[] = [];
    lines.forEach((line, idx) => {
      if (line.startsWith("<<<<<<<")) { inConflict = true; inOurs = true; startLine = idx + 1; ourLines = []; baseLines = []; theirLines = []; }
      else if (line.startsWith("|||||||") && inConflict) { inOurs = false; inBase = true; inTheirs = false; }
      else if (line.startsWith("=======") && inConflict) { inOurs = false; inBase = false; inTheirs = true; }
      else if (line.startsWith(">>>>>>>") && inConflict) { markers.push({ filePath, ourLines: [...ourLines], theirLines: [...theirLines], baseLines: [...baseLines], startLine, endLine: idx + 1 }); inConflict = false; inOurs = false; inBase = false; inTheirs = false; }
      else if (inConflict) { if (inOurs) ourLines.push(line); else if (inBase) baseLines.push(line); else if (inTheirs) theirLines.push(line); }
    });
    return markers;
  }

  public async resolveFile(repositoryPath: string, cf: ConflictFile): Promise<ConflictResolution> {
    if (!isLlmAvailable()) return this.resolveDeterministic(repositoryPath, cf);
    return this.resolveWithLlm(repositoryPath, cf);
  }

  private async resolveWithLlm(_repositoryPath: string, cf: ConflictFile): Promise<ConflictResolution> {
    const prompt = `You are a senior software engineer resolving a merge conflict.\n\nFILE: ${cf.filePath}\n\nCONFLICTS TO RESOLVE (${cf.markers.length} conflict(s)):\n\n${cf.markers.map((m, i) => `\n--- CONFLICT ${i + 1} (lines ${m.startLine}-${m.endLine}) ---\n=== OUR CHANGES (current branch) ===\n${m.ourLines.join("\n")}\n\n=== BASE (common ancestor) ===\n${m.baseLines.join("\n") || "(no base — new file conflict)"}\n\n=== THEIR CHANGES (incoming branch) ===\n${m.theirLines.join("\n")}`).join("\n")}\n\nRules:\n1. DO NOT blindly choose "ours" or "theirs" — semantically merge both changes\n2. Preserve the intent of BOTH sides\n3. If one side adds null-safety and the other adds a feature, include both\n4. Respond in JSON:\n{"resolution":"...","strategy":"ai_semantic","explanation":"...","confidence":0.0-1.0,"warnings":[...]}`;
    try {
      const response = await callLlm([{ role: "system", content: "You are a merge conflict resolver. Output only valid JSON." }, { role: "user", content: prompt }]);
      const jsonMatch = /\{[\s\S]*\}/.exec(response.content);
      if (!jsonMatch) throw new Error("No JSON");
      const parsed = JSON.parse(jsonMatch[0]) as { resolution?: string; strategy?: "ours" | "theirs" | "merged" | "ai_semantic"; explanation?: string; confidence?: number; warnings?: string[] };
      return { filePath: cf.filePath, resolvedContent: parsed.resolution ?? "", strategy: parsed.strategy ?? "ai_semantic", explanation: parsed.explanation ?? "AI semantic merge applied.", confidence: parsed.confidence ?? 0.8, warnings: parsed.warnings ?? [] };
    } catch { return this.resolveDeterministic(_repositoryPath, cf); }
  }

  private resolveDeterministic(_repositoryPath: string, cf: ConflictFile): ConflictResolution {
    const resolvedLines: string[] = [];
    for (const marker of cf.markers) {
      const combined = [...marker.ourLines, ...marker.theirLines.filter((l) => !marker.ourLines.includes(l))];
      resolvedLines.push(...combined);
    }
    return { filePath: cf.filePath, resolvedContent: resolvedLines.join("\n"), strategy: "merged", explanation: "Deterministic merge: combined unique lines from both sides. Manual review recommended.", confidence: 0.5, warnings: ["LLM not available — manual review of this resolution is strongly recommended.", "Deterministic merge may not preserve semantic intent."] };
  }

  async applyResolution(repositoryPath: string, resolution: ConflictResolution): Promise<{ success: boolean; error?: string }> {
    try {
      await fs.writeFile(path.resolve(repositoryPath, resolution.filePath), resolution.resolvedContent, "utf-8");
      const validatedPath = validateFilePath(resolution.filePath);
      await safeExec(`git add "${validatedPath}"`, repositoryPath);
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async resolveAllConflicts(repositoryPath: string): Promise<{ success: boolean; analysis: ConflictAnalysis; appliedCount: number; errors: string[] }> {
    const analysis = await this.analyzeRepository(repositoryPath);
    const errors: string[] = [];
    let appliedCount = 0;
    for (const resolution of analysis.resolutions) { const result = await this.applyResolution(repositoryPath, resolution); if (result.success) appliedCount++; else if (result.error) errors.push(`${resolution.filePath}: ${result.error}`); }
    return { success: errors.length === 0, analysis, appliedCount, errors };
  }
}

export const conflictAnalyzer = new ConflictAnalyzer();
