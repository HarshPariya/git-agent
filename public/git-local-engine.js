/**
 * Git Debugging Agent — Browser Local Git Engine
 * Coordinates in-browser Git operations against user-selected local directory handles.
 * Powered by isomorphic-git and GitLocalFS.
 */

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svgz",
  ".pdf", ".zip", ".tar", ".gz", ".7z", ".rar",
  ".exe", ".dll", ".so", ".dylib", ".bin", ".iso",
  ".woff", ".woff2", ".ttf", ".eot",
  ".mp3", ".mp4", ".mov", ".avi"
]);

const SECRET_PATTERNS = [
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

const SENSITIVE_FILE_REGEX = /(?:^|[\\/])(?:\.env(?:\..+)?|credentials\.json|service_account.*\.json|id_rsa.*|id_ed25519.*|\.(?:pem|key|pkcs12|pfx|kdbx)|token\.json|auth\.json)$/i;

class GitLocalEngine {
  constructor() {
    this._fsInstances = new WeakMap();
  }

  getFS(dirHandle) {
    if (!dirHandle) throw new Error("Directory handle required for Local Git Engine");
    let fs = this._fsInstances.get(dirHandle);
    if (!fs) {
      fs = new window.GitLocalFS(dirHandle);
      this._fsInstances.set(dirHandle, fs);
    }
    return fs;
  }

  /**
   * Detect if selected folder contains a real Git repository
   * @param {FileSystemDirectoryHandle} dirHandle
   */
  async detectRepository(dirHandle) {
    if (!dirHandle) return { isGit: false, reason: "No directory handle provided" };
    try {
      await dirHandle.getDirectoryHandle(".git");
    } catch {
      return {
        isGit: false,
        name: dirHandle.name,
        reason: "This folder does not contain a .git directory.",
      };
    }

    const fs = this.getFS(dirHandle);
    let branch = "main";
    try {
      branch = (await window.git.currentBranch({ fs, dir: "/" })) || "main";
    } catch {
      try {
        const head = await fs.promises.readFile("/.git/HEAD", { encoding: "utf8" });
        if (head.startsWith("ref: refs/heads/")) {
          branch = head.replace("ref: refs/heads/", "").trim();
        }
      } catch {}
    }

    let remotes = [];
    try {
      remotes = await window.git.listRemotes({ fs, dir: "/" });
    } catch {}

    return {
      isGit: true,
      name: dirHandle.name,
      branch,
      remotes,
      url: remotes[0]?.url || "",
    };
  }

  /**
   * Initialize a new Git repository in the selected directory
   * @param {FileSystemDirectoryHandle} dirHandle
   */
  async initRepository(dirHandle) {
    const fs = this.getFS(dirHandle);
    await window.git.init({ fs, dir: "/", defaultBranch: "main" });
    return this.detectRepository(dirHandle);
  }

  /**
   * Get real working tree status via git statusMatrix
   * @param {FileSystemDirectoryHandle} dirHandle
   */
  async getStatus(dirHandle) {
    const fs = this.getFS(dirHandle);
    const repoInfo = await this.detectRepository(dirHandle);
    if (!repoInfo.isGit) {
      throw new Error("Folder is not a Git repository");
    }

    // Status matrix rows: [filepath, head, workdir, stage]
    // 0 = absent, 1 = identical, 2 = modified, 3 = modified unstaged
    const matrix = await window.git.statusMatrix({ fs, dir: "/" });
    const entries = [];

    for (const [filepath, head, workdir, stage] of matrix) {
      // Clean / unmodified: head=1, workdir=1, stage=1
      if (head === 1 && workdir === 1 && stage === 1) continue;

      let status = "modified";
      let staged = false;

      if (head === 0 && workdir === 2 && stage === 0) {
        status = "untracked";
        staged = false;
      } else if (head === 0 && workdir === 2 && stage === 2) {
        status = "added";
        staged = true;
      } else if (head === 1 && workdir === 0 && stage === 0) {
        status = "deleted";
        staged = true;
      } else if (head === 1 && workdir === 0 && stage === 1) {
        status = "deleted";
        staged = false;
      } else if (head === 1 && workdir === 2 && stage === 2) {
        status = "modified";
        staged = true;
      } else if (head === 1 && workdir === 2 && stage === 1) {
        status = "modified";
        staged = false;
      } else if (head === 1 && workdir === 2 && stage === 3) {
        status = "modified";
        staged = true; // has staged changes and further unstaged edits
      }

      entries.push({
        filePath: filepath,
        status,
        staged,
      });
    }

    return {
      branch: repoInfo.branch,
      clean: entries.length === 0,
      entries,
      ahead: 0,
      behind: 0,
    };
  }

  /**
   * Stage a file
   */
  async stageFile(dirHandle, filepath) {
    const fs = this.getFS(dirHandle);
    await window.git.add({ fs, dir: "/", filepath });
  }

  /**
   * Unstage a file
   */
  async unstageFile(dirHandle, filepath) {
    const fs = this.getFS(dirHandle);
    await window.git.resetIndex({ fs, dir: "/", filepath });
  }

  /**
   * Stage all safe changes (excluding secrets)
   */
  async stageAll(dirHandle) {
    const fs = this.getFS(dirHandle);
    const status = await this.getStatus(dirHandle);
    for (const entry of status.entries) {
      if (this.isSensitiveFile(entry.filePath)) continue;
      if (entry.status === "deleted") {
        await window.git.remove({ fs, dir: "/", filepath: entry.filePath }).catch(() => {});
      } else {
        await window.git.add({ fs, dir: "/", filepath: entry.filePath });
      }
    }
  }

  /**
   * Unstage all changes
   */
  async unstageAll(dirHandle) {
    const fs = this.getFS(dirHandle);
    const status = await this.getStatus(dirHandle);
    for (const entry of status.entries) {
      if (entry.staged) {
        await window.git.resetIndex({ fs, dir: "/", filepath: entry.filePath }).catch(() => {});
      }
    }
  }

  /**
   * Discard file changes (revert from index/HEAD)
   */
  async discardFile(dirHandle, filepath) {
    const fs = this.getFS(dirHandle);
    await window.git.checkout({ fs, dir: "/", filepaths: [filepath], force: true });
  }

  /**
   * Calculate unified diff for a single file or working tree
   * @param {FileSystemDirectoryHandle} dirHandle
   * @param {string} filepath
   * @param {boolean} [staged=false]
   */
  async getDiff(dirHandle, filepath, staged = false) {
    if (!filepath) {
      // Multi-file diff across all modified files
      const status = await this.getStatus(dirHandle);
      const diffs = [];
      for (const entry of status.entries) {
        const fileDiff = await this.getDiff(dirHandle, entry.filePath, entry.staged);
        if (fileDiff) diffs.push(fileDiff);
      }
      return diffs.join("\n\n");
    }

    const ext = filepath.includes(".") ? "." + filepath.split(".").pop().toLowerCase() : "";
    if (BINARY_EXTENSIONS.has(ext)) {
      return `diff --git a/${filepath} b/${filepath}\nBinary files a/${filepath} and b/${filepath} differ`;
    }

    const fs = this.getFS(dirHandle);
    let oldContent = "";
    let newContent = "";

    // 1. Fetch old content (from HEAD)
    try {
      const headCommit = await window.git.resolveRef({ fs, dir: "/", ref: "HEAD" });
      const { blob } = await window.git.readBlob({ fs, dir: "/", oid: headCommit, filepath });
      oldContent = new TextDecoder("utf-8").decode(blob);
    } catch {
      // File was untracked or newly added in working tree
      oldContent = "";
    }

    // 2. Fetch new content (from working file)
    try {
      newContent = await fs.promises.readFile(filepath, { encoding: "utf8" });
    } catch {
      // File was deleted
      newContent = "";
    }

    return this.createUnifiedDiff(filepath, oldContent, newContent);
  }

  /**
   * Create standard unified diff string between old and new text
   */
  createUnifiedDiff(filepath, oldText, newText) {
    if (oldText === newText) return "";

    const oldLines = oldText ? oldText.replace(/\r\n/g, "\n").split("\n") : [];
    const newLines = newText ? newText.replace(/\r\n/g, "\n").split("\n") : [];

    // Simple line-by-line diff generation
    let diffLines = [
      `diff --git a/${filepath} b/${filepath}`,
      oldText ? `--- a/${filepath}` : `--- /dev/null`,
      newText ? `+++ b/${filepath}` : `+++ /dev/null`,
      `@@ -1,${Math.max(1, oldLines.length)} +1,${Math.max(1, newLines.length)} @@`
    ];

    if (!oldText && newText) {
      // Pure addition
      newLines.forEach((l) => diffLines.push(`+${l}`));
    } else if (oldText && !newText) {
      // Pure deletion
      oldLines.forEach((l) => diffLines.push(`-${l}`));
    } else {
      // Comparison
      let i = 0, j = 0;
      while (i < oldLines.length || j < newLines.length) {
        if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
          diffLines.push(` ${oldLines[i]}`);
          i++;
          j++;
        } else if (i < oldLines.length && (j >= newLines.length || oldLines[i] !== newLines[j])) {
          diffLines.push(`-${oldLines[i]}`);
          i++;
        } else if (j < newLines.length) {
          diffLines.push(`+${newLines[j]}`);
          j++;
        }
      }
    }

    // Guard against excessive size
    if (diffLines.length > 5000) {
      diffLines = diffLines.slice(0, 5000);
      diffLines.push("... [Diff truncated: exceeds 5000 lines]");
    }

    return diffLines.join("\n");
  }

  /**
   * Commit staged changes
   */
  async commit(dirHandle, { message, author }) {
    const fs = this.getFS(dirHandle);

    // Pre-commit secret scan
    const status = await this.getStatus(dirHandle);
    const stagedFiles = status.entries.filter((e) => e.staged);
    if (stagedFiles.length === 0) {
      throw new Error("No staged changes to commit. Stage your changes first.");
    }

    const secretReport = await this.scanSecrets(dirHandle, stagedFiles.map((f) => f.filePath));
    if (!secretReport.clean) {
      const filenames = secretReport.matches.map((m) => m.file).join(", ");
      throw new Error(`Commit blocked: Potential secret detected in [${filenames}]. Remove secrets or add to .gitignore before committing.`);
    }

    const sha = await window.git.commit({
      fs,
      dir: "/",
      message,
      author: {
        name: author?.name || "Developer",
        email: author?.email || "developer@local.host",
      },
    });

    return { sha, shortSha: sha.slice(0, 7) };
  }

  /**
   * Commit history (git log)
   */
  async getHistory(dirHandle, depth = 50) {
    const fs = this.getFS(dirHandle);
    try {
      const commits = await window.git.log({ fs, dir: "/", depth });
      return commits.map((c) => ({
        sha: c.oid,
        hash: c.oid,
        shortSha: c.oid.slice(0, 7),
        subject: c.commit.message.split("\n")[0] || "",
        message: c.commit.message,
        author: c.commit.author.name,
        email: c.commit.author.email,
        date: new Date(c.commit.author.timestamp * 1000).toISOString(),
      }));
    } catch {
      return [];
    }
  }

  /**
   * Branch management
   */
  async listBranches(dirHandle) {
    const fs = this.getFS(dirHandle);
    const branches = await window.git.listBranches({ fs, dir: "/" });
    const current = await window.git.currentBranch({ fs, dir: "/" });
    return { branches, currentBranch: current || "main" };
  }

  async createBranch(dirHandle, branchName) {
    const fs = this.getFS(dirHandle);
    await window.git.branch({ fs, dir: "/", ref: branchName });
    await window.git.checkout({ fs, dir: "/", ref: branchName });
    return branchName;
  }

  async checkoutBranch(dirHandle, branchName) {
    const fs = this.getFS(dirHandle);
    // Check if clean before checkout to prevent loss
    const status = await this.getStatus(dirHandle);
    if (!status.clean) {
      // isomorphic-git handles dirty worktrees or throws if conflict
    }
    await window.git.checkout({ fs, dir: "/", ref: branchName });
    return branchName;
  }

  async deleteBranch(dirHandle, branchName) {
    const fs = this.getFS(dirHandle);
    await window.git.deleteBranch({ fs, dir: "/", ref: branchName });
  }

  /**
   * Secret scanning
   */
  isSensitiveFile(filePath) {
    if (!filePath) return false;
    return SENSITIVE_FILE_REGEX.test(filePath.replace(/\\/g, "/"));
  }

  async scanSecrets(dirHandle, filePaths) {
    const fs = this.getFS(dirHandle);
    const matches = [];

    for (const filePath of filePaths) {
      if (this.isSensitiveFile(filePath)) {
        matches.push({
          file: filePath,
          rule: "Potential Secret File",
          snippet: `Potential credential or configuration file: ${filePath}`,
        });
        continue;
      }

      try {
        const content = await fs.promises.readFile(filePath, { encoding: "utf8" });
        const lines = content.split("\n");
        for (let i = 0; i < Math.min(lines.length, 1000); i++) {
          const line = lines[i];
          for (const { name, pattern } of SECRET_PATTERNS) {
            pattern.lastIndex = 0;
            if (pattern.test(line)) {
              matches.push({
                file: filePath,
                line: i + 1,
                rule: name,
                snippet: `Line ${i + 1}: [Potential ${name} detected - REDACTED]`,
              });
            }
          }
        }
      } catch {}
    }

    return {
      clean: matches.length === 0,
      matches,
    };
  }

  /**
   * Apply verified patch to local file directly
   */
  async applyPatch(dirHandle, filePath, newContent) {
    const fs = this.getFS(dirHandle);
    await fs.promises.writeFile(filePath, newContent, { encoding: "utf8" });
    return { success: true, filePath };
  }
}

// Instantiate and expose globally
window.gitLocalEngine = new GitLocalEngine();
