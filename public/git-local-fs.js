/**
 * Git Debugging Agent — Browser Local Filesystem Adapter for isomorphic-git
 * Implements the Node.js `fs.promises` specification backed directly by a W3C FileSystemDirectoryHandle.
 *
 * This enables isomorphic-git to run 100% inside the browser on the user's real PC folder.
 * Zero files are uploaded to Render for local git operations.
 */

class GitLocalFSPromises {
  /**
   * @param {FileSystemDirectoryHandle} rootHandle
   */
  constructor(rootHandle) {
    this.root = rootHandle;
  }

  /**
   * Normalize a path into array of segments
   * @param {string} p
   * @returns {string[]}
   */
  _splitPath(p) {
    if (!p) return [];
    return p
      .replace(/\\/g, "/")
      .replace(/^\/+|\/+$/g, "")
      .split("/")
      .filter((s) => s.length > 0 && s !== ".");
  }

  /**
   * Navigate to the parent directory handle of the target path
   * @param {string[]} segments
   * @param {boolean} create
   * @returns {Promise<{ parentHandle: FileSystemDirectoryHandle, name: string }>}
   */
  async _resolveParent(segments, create = false) {
    if (segments.length === 0) {
      throw this._createError("EINVAL", "Invalid root path target");
    }
    let curr = this.root;
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i];
      try {
        curr = await curr.getDirectoryHandle(seg, { create });
      } catch (err) {
        throw this._createError("ENOENT", `No such directory: ${segments.slice(0, i + 1).join("/")}`);
      }
    }
    return { parentHandle: curr, name: segments[segments.length - 1] };
  }

  _createError(code, message) {
    const err = new Error(`${code}: ${message}`);
    err.code = code;
    return err;
  }

  /**
   * Read file content as Uint8Array (or string if utf8 encoding requested)
   * @param {string} filepath
   * @param {object|string} [options]
   * @returns {Promise<Uint8Array|string>}
   */
  async readFile(filepath, options) {
    const segments = this._splitPath(filepath);
    if (segments.length === 0) {
      throw this._createError("EISDIR", "Cannot read directory as file: /");
    }

    const { parentHandle, name } = await this._resolveParent(segments, false);
    try {
      const fileHandle = await parentHandle.getFileHandle(name);
      const file = await fileHandle.getFile();
      const buffer = await file.arrayBuffer();
      const uint8 = new Uint8Array(buffer);

      const enc = typeof options === "string" ? options : options?.encoding;
      if (enc === "utf8" || enc === "utf-8") {
        return new TextDecoder("utf-8").decode(uint8);
      }
      return uint8;
    } catch (err) {
      if (err.name === "NotFoundError" || err.code === "ENOENT") {
        throw this._createError("ENOENT", `No such file: ${filepath}`);
      }
      throw err;
    }
  }

  /**
   * Write data to file
   * @param {string} filepath
   * @param {string|Uint8Array|ArrayBuffer} data
   * @param {object|string} [options]
   */
  async writeFile(filepath, data, options) {
    const segments = this._splitPath(filepath);
    if (segments.length === 0) {
      throw this._createError("EISDIR", "Cannot write file to root directory path");
    }

    const { parentHandle, name } = await this._resolveParent(segments, true);
    try {
      const fileHandle = await parentHandle.getFileHandle(name, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(data);
      await writable.close();
    } catch (err) {
      throw this._createError("EIO", `Failed to write file ${filepath}: ${err.message}`);
    }
  }

  /**
   * Remove a file
   * @param {string} filepath
   */
  async unlink(filepath) {
    const segments = this._splitPath(filepath);
    if (segments.length === 0) {
      throw this._createError("EBUSY", "Cannot unlink root directory");
    }

    const { parentHandle, name } = await this._resolveParent(segments, false);
    try {
      await parentHandle.removeEntry(name);
    } catch (err) {
      if (err.name === "NotFoundError" || err.code === "ENOENT") {
        throw this._createError("ENOENT", `No such file to unlink: ${filepath}`);
      }
      throw err;
    }
  }

  /**
   * List entries in directory
   * @param {string} dirpath
   * @returns {Promise<string[]>}
   */
  async readdir(dirpath) {
    const segments = this._splitPath(dirpath);
    let target = this.root;

    if (segments.length > 0) {
      for (let i = 0; i < segments.length; i++) {
        try {
          target = await target.getDirectoryHandle(segments[i]);
        } catch (err) {
          throw this._createError("ENOENT", `No such directory: ${dirpath}`);
        }
      }
    }

    const entries = [];
    try {
      for await (const [name] of target.entries()) {
        entries.push(name);
      }
      return entries;
    } catch (err) {
      throw this._createError("EIO", `Failed to readdir ${dirpath}: ${err.message}`);
    }
  }

  /**
   * Create directory
   * @param {string} dirpath
   */
  async mkdir(dirpath) {
    const segments = this._splitPath(dirpath);
    if (segments.length === 0) return;

    let curr = this.root;
    for (const seg of segments) {
      curr = await curr.getDirectoryHandle(seg, { create: true });
    }
  }

  /**
   * Remove directory
   * @param {string} dirpath
   */
  async rmdir(dirpath) {
    const segments = this._splitPath(dirpath);
    if (segments.length === 0) {
      throw this._createError("EBUSY", "Cannot remove root directory");
    }

    const { parentHandle, name } = await this._resolveParent(segments, false);
    try {
      await parentHandle.removeEntry(name, { recursive: false });
    } catch (err) {
      if (err.name === "NotFoundError" || err.code === "ENOENT") {
        throw this._createError("ENOENT", `No such directory: ${dirpath}`);
      }
      throw err;
    }
  }

  /**
   * Stat file or directory
   * @param {string} filepath
   */
  async stat(filepath) {
    const segments = this._splitPath(filepath);
    if (segments.length === 0) {
      // Root directory stat
      return {
        type: "dir",
        mode: 0o040755,
        size: 0,
        mtimeMs: Date.now(),
        ctimeMs: Date.now(),
        ino: 0,
        uid: 1,
        gid: 1,
        dev: 1,
        isFile: () => false,
        isDirectory: () => true,
        isSymbolicLink: () => false,
      };
    }

    const { parentHandle, name } = await this._resolveParent(segments, false);

    // Try directory first
    try {
      await parentHandle.getDirectoryHandle(name);
      return {
        type: "dir",
        mode: 0o040755,
        size: 0,
        mtimeMs: Date.now(),
        ctimeMs: Date.now(),
        ino: 0,
        uid: 1,
        gid: 1,
        dev: 1,
        isFile: () => false,
        isDirectory: () => true,
        isSymbolicLink: () => false,
      };
    } catch (_) {
      // Not a directory, try file
    }

    // Try file
    try {
      const fileHandle = await parentHandle.getFileHandle(name);
      const file = await fileHandle.getFile();
      return {
        type: "file",
        mode: 0o100644,
        size: file.size,
        mtimeMs: file.lastModified || Date.now(),
        ctimeMs: file.lastModified || Date.now(),
        ino: 0,
        uid: 1,
        gid: 1,
        dev: 1,
        isFile: () => true,
        isDirectory: () => false,
        isSymbolicLink: () => false,
      };
    } catch (err) {
      throw this._createError("ENOENT", `No such file or directory: ${filepath}`);
    }
  }

  async lstat(filepath) {
    return this.stat(filepath);
  }

  async readlink() {
    throw this._createError("ENOSYS", "Symbolic links not supported in browser filesystem");
  }

  async symlink() {
    throw this._createError("ENOSYS", "Symbolic links not supported in browser filesystem");
  }
}

class GitLocalFS {
  /**
   * @param {FileSystemDirectoryHandle} rootHandle
   */
  constructor(rootHandle) {
    this.root = rootHandle;
    this.promises = new GitLocalFSPromises(rootHandle);
  }
}

// Export to window for browser runtime
window.GitLocalFS = GitLocalFS;
