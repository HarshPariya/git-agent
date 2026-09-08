/**
 * Git Debugging Agent — Merge Conflict Center View Module
 * 3-way / 4-way merge conflict inspection (Base, Ours, Theirs, AI Resolution)
 * and semantic conflict resolution engine
 */

async function loadConflictsPage() {
  const repo = window.state.activeRepository || window.state.repositories[0];
  const container = document.getElementById("conflicts-container");
  if (!container) return;

  if (!repo) {
    container.innerHTML = `
      <div class="empty-state" style="padding:48px 24px">
        <div class="empty-icon">📁</div>
        <div class="empty-title">Select a repository</div>
        <div class="empty-desc">Choose a repository to inspect and resolve merge conflicts.</div>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div class="empty-state" style="padding:48px 24px">
      <div class="empty-icon">⚡</div>
      <div class="empty-title">Analyzing conflicts...</div>
      <div class="empty-desc">Scanning repository for merge markers and analyzing common ancestors.</div>
    </div>`;

  try {
    const data = await api.getGitConflicts(repo.id);
    const conflicts = data.conflicts || data.files || [];

    if (!conflicts || conflicts.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding:48px 24px">
          <div class="empty-icon">🌿</div>
          <div class="empty-title">No Active Conflicts</div>
          <div class="empty-desc">Working tree in "${escapeHtml(repo.name || "repo")}" has zero unresolved merge conflicts.</div>
        </div>`;
      return;
    }

    let html = `<div style="padding:16px"><div style="font-weight:700;margin-bottom:12px;color:var(--c-danger)">⚠️ ${conflicts.length} CONFLICTING FILE(S) DETECTED</div>`;

    conflicts.forEach((c) => {
      html += `
        <div class="card" style="margin-bottom:16px;padding:0;overflow:hidden">
          <div class="card-header" style="background:#fffbeb;padding:10px 16px;display:flex;justify-content:space-between;align-items:center">
            <div style="font-weight:700;font-family:var(--font-mono)">${escapeHtml(c.filePath)}</div>
            <button class="btn btn-primary btn-sm" data-action="triggerResolveFileConflict" data-value="${escapeHtml(c.filePath)}">
              ⚡ Semantic Resolve This File
            </button>
          </div>
          <div class="conflicts-4way-grid">
            <div class="conflict-pane base">
              <div class="conflict-pane-header">BASE (Merge Ancestor)</div>
              <div class="conflict-pane-body">${escapeHtml(c.baseLines?.join("\n") || "No base version")}</div>
            </div>
            <div class="conflict-pane ours">
              <div class="conflict-pane-header">OURS (Current Branch)</div>
              <div class="conflict-pane-body">${escapeHtml(c.ourLines?.join("\n") || "No our version")}</div>
            </div>
            <div class="conflict-pane theirs">
              <div class="conflict-pane-header">THEIRS (Incoming Branch)</div>
              <div class="conflict-pane-body">${escapeHtml(c.theirLines?.join("\n") || "No their version")}</div>
            </div>
            <div class="conflict-pane resolved">
              <div class="conflict-pane-header">AI RESOLUTION (Synthesized)</div>
              <div class="conflict-pane-body">${escapeHtml(c.resolvedContent || "Ready to synthesize...")}</div>
            </div>
          </div>
        </div>`;
    });

    html += `</div>`;
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `
      <div class="empty-state" style="padding:48px 24px">
        <div class="empty-title" style="color:var(--c-danger)">Conflict Check Error</div>
        <div class="empty-desc">${escapeHtml(err.message)}</div>
      </div>`;
  }
}

async function triggerResolveAllConflicts() {
  const repo = window.state.activeRepository;
  if (!repo) return;

  showToast("Resolving all conflicts with AI semantic synthesis...", "info");
  try {
    const res = await api.resolveConflicts(repo.id);
    showToast(res.message || "Conflicts resolved successfully!", "success");
    await loadConflictsPage();
  } catch (err) {
    showToast(`Conflict resolution error: ${err.message}`, "error");
  }
}

async function triggerResolveFileConflict(filePath) {
  const repo = window.state.activeRepository;
  if (!repo) return;

  showToast(`Resolving conflicts in ${filePath}...`, "info");
  try {
    const res = await api.resolveConflicts(repo.id, filePath);
    showToast(res.message || `Resolved ${filePath}!`, "success");
    await loadConflictsPage();
  } catch (err) {
    showToast(`File resolution error: ${err.message}`, "error");
  }
}

async function loadConflictsTab(repoId) {
  const container = document.getElementById("conflicts-view");
  if (!container) return;

  try {
    const analysis = await api.getGitConflicts(repoId);
    const conflicts = analysis.conflictFiles || [];

    if (!conflicts || conflicts.length === 0) {
      container.innerHTML = `
        <div style="text-align:center;padding:24px;color:var(--c-text-muted)">
          <div style="font-size:24px;margin-bottom:8px">✓</div>
          <div style="font-weight:600;font-size:14px;color:var(--c-text)">No Merge Conflicts Detected</div>
          <div style="font-size:12px">Working tree merge state is clean and linear.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = conflicts.map((cf) => `
      <div class="conflict-card">
        <div class="conflict-card-header">
          <span>📄 ${escapeHtml(cf.filePath)}</span>
          <span class="badge badge-danger">${cf.markers.length} conflict(s)</span>
        </div>
        ${cf.markers.map((m, idx) => `
          <div style="padding:10px 14px;border-bottom:1px solid var(--c-border-subtle);font-size:11px;font-weight:600;color:var(--c-text-muted)">
            Conflict Region #${idx + 1} (lines ${m.startLine}–${m.endLine})
          </div>
          <div class="conflict-split">
            <div class="conflict-side ours">
              <div class="conflict-side-title">=== OURS (Current Branch) ===</div>
              <div class="conflict-code">${escapeHtml(m.ourLines.join("\n") || "(empty)")}</div>
            </div>
            <div class="conflict-side theirs">
              <div class="conflict-side-title">=== THEIRS (Incoming Branch) ===</div>
              <div class="conflict-code">${escapeHtml(m.theirLines.join("\n") || "(empty)")}</div>
            </div>
          </div>
        `).join("")}
      </div>
    `).join("");
  } catch (err) {
    container.innerHTML = `<div class="text-muted" style="font-size:13px">No merge conflicts active in repository.</div>`;
  }
}

async function resolveConflicts() {
  const repoId = window.state.currentSession?.repositoryId || document.getElementById("debug-repo")?.value || window.state?.activeRepository?.id;
  if (!repoId) {
    showToast("No repository selected", "error");
    return;
  }

  const btn = document.getElementById("resolve-conflicts-btn");
  try {
    if (btn) { btn.disabled = true; btn.textContent = "Resolving..."; }
    showToast("Running Groq AI semantic merge resolution...", "info");
    const res = await api.resolveConflicts(repoId);
    if (res.success) {
      showToast(`Successfully resolved and staged ${res.appliedCount} conflict(s)!`, "success");
      await loadConflictsTab(repoId);
    } else {
      showToast(`Conflict resolution completed with warnings: ${res.errors?.join("; ")}`, "warning");
      await loadConflictsTab(repoId);
    }
  } catch (err) {
    showToast(`Failed to resolve conflicts: ${err.message}`, "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "⚡ AI Semantic Resolve All"; }
  }
}

// Event delegation for data-action attributes
document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  const value = target.dataset.value;
  if (action === 'triggerResolveFileConflict') triggerResolveFileConflict(value);
});

// Window exports
window.loadConflictsPage = loadConflictsPage;
window.triggerResolveAllConflicts = triggerResolveAllConflicts;
window.triggerResolveFileConflict = triggerResolveFileConflict;
window.loadConflictsTab = loadConflictsTab;
window.resolveConflicts = resolveConflicts;
