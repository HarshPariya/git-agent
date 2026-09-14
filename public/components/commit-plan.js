/**
 * Git Debugging Agent — Semantic Commit Plan Component
 * Renders atomic Conventional Commit groups, handles message edits,
 * and orchestrates One-Click 'AI Commit All'.
 */

// Uses window.escapeHtml from app.js

function renderCommitPlanView(plan) {
  const container = document.getElementById("gd-commit-plan-container");
  if (!container) return;

  if (!plan?.groups?.length) {
    container.innerHTML = `
      <div class="empty-state" style="padding:28px 16px;text-align:center">
        <div class="empty-icon" style="font-size:28px">🤖</div>
        <div class="empty-title" style="font-size:14px;font-weight:700">No Commit Plan Active</div>
        <div class="empty-desc" style="font-size:12px;color:var(--c-text-muted);margin:6px 0 14px 0">
          Analyze working tree changes to create semantic Conventional Commit groups.
        </div>
        <button class="btn btn-primary btn-sm" data-action="triggerAIAnalyzeChanges" style="width:100%">⚡ AI Analyze Changes</button>
      </div>
    `;
    return;
  }

  const groupsHtml = plan.groups.map((group, idx) => {
    const riskBadge = group.risk === "high" ? "badge-danger" : group.risk === "medium" ? "badge-warning" : "badge-success";
    const sub = group.suggestedCommit?.subject || group.name;
    const type = group.suggestedCommit?.type || "feat";
    const files = group.files || [];
    const groupId = window.escapeHtml(group.id);

    return `
      <div class="commit-group-card" id="commit-group-${groupId}" style="margin-bottom:12px;padding:12px;border:1px solid var(--c-border);border-radius:var(--radius-md);background:var(--c-surface-card)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          <div style="display:flex;align-items:center;gap:6px">
            <span class="badge badge-accent" style="font-size:10px">Group ${idx + 1}</span>
            <span class="badge ${riskBadge}" style="font-size:10px">${group.risk.toUpperCase()}</span>
          </div>
          <span style="font-size:11px;color:var(--c-text-muted)">${files.length} file${files.length > 1 ? "s" : ""}</span>
        </div>

        <div style="font-weight:600;font-size:13px;color:var(--c-text);margin-bottom:4px">
          <code>${window.escapeHtml(type)}</code>: ${window.escapeHtml(sub)}
        </div>
        <div style="font-size:11px;color:var(--c-text-muted);margin-bottom:8px;line-height:1.4">
          ${window.escapeHtml(group.reason || "Logical atomic update")}
        </div>

        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px">
          ${files.map(f => `<span class="badge badge-secondary" style="font-size:10px;font-family:var(--font-mono)">${window.escapeHtml(f.split("/").pop())}</span>`).join("")}
        </div>

        <div style="display:flex;gap:6px;justify-content:flex-end">
          <button class="btn btn-secondary btn-sm" data-action="editGroupCommitMessage" data-value="${groupId}" style="font-size:11px;padding:2px 8px">✏️ Edit</button>
          <button class="btn btn-secondary btn-sm" data-action="previewGroupDiff" data-value="${groupId}" style="font-size:11px;padding:2px 8px">🔍 Diff</button>
        </div>
      </div>
    `;
  }).join("");

  container.innerHTML = `
    <div style="padding:10px 4px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div style="font-size:12px;font-weight:700;color:var(--c-text)">${plan.groups.length} Logical Commits Planned</div>
        <button class="btn btn-primary btn-sm" id="btn-commit-all" data-action="executeCommitPlanAll" style="display:flex;align-items:center;gap:6px">
          ⚡ Commit All (${plan.groups.length})
        </button>
      </div>
      <div style="max-height:480px;overflow-y:auto">
        ${groupsHtml}
      </div>
    </div>
  `;
}

async function executeCommitPlanAll() {
  const repo = window.state?.activeRepository;
  const plan = window.state?.gitDesktop?.commitPlan;
  if (!repo || !plan?.groups?.length) {
    showToast("No active commit plan to execute", "warning");
    return;
  }

  const btn = document.getElementById("btn-commit-all");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Executing Commits...";
  }

  try {
    const res = await api.request("/api/git/commit-plan/execute", {
      method: "POST",
      body: JSON.stringify({
        repositoryId: repo.id,
        groups: plan.groups,
      }),
    });

    if (res.success) {
      showToast(`Successfully created ${res.totalCreated || res.commits?.length || 0} commits!`, "success");
      window.state.gitDesktop.commitPlan = null;
      window.notifyStateChange("gitDesktop.commitPlan", null);
      if (typeof window.loadGitDesktop === "function") {
        await window.loadGitDesktop();
      }
    } else {
      showToast(`Commit plan execution failed: ${res.message || res.error}`, "error");
    }
  } catch (err) {
    showToast(`Execution error: ${err.message}`, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = `⚡ Commit All (${plan.groups.length})`;
    }
  }
}

function editGroupCommitMessage(groupId) {
  const plan = window.state?.gitDesktop?.commitPlan;
  const group = plan?.groups?.find(g => g.id === groupId);
  if (!group) return;

  const newSubject = prompt("Edit Conventional Commit Subject:", group.suggestedCommit?.subject || group.name);
  if (!newSubject?.trim()) return;

  const idx = plan.groups.indexOf(group);
  if (plan.groups[idx]?.suggestedCommit) {
    plan.groups[idx].suggestedCommit.subject = newSubject.trim();
  }
  window.notifyStateChange("gitDesktop.commitPlan", plan);
  renderCommitPlanView(plan);
  showToast("Updated commit subject for group", "success");
}

function previewGroupDiff(groupId) {
  const plan = window.state?.gitDesktop?.commitPlan;
  const group = plan?.groups?.find(g => g.id === groupId);
  if (!group?.files?.length) return;

  const repo = window.state?.activeRepository;
  if (repo && typeof window.switchGitDesktopTab === "function") {
    window.switchGitDesktopTab("diff");
  }
}

// Export to window
window.renderCommitPlanView = renderCommitPlanView;
window.executeCommitPlanAll = executeCommitPlanAll;
window.editGroupCommitMessage = editGroupCommitMessage;
window.previewGroupDiff = previewGroupDiff;
