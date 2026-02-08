import type { Prereq, MissingPrereqResult, RecommendedPrereqResult } from "../core";

interface PrerequisitesPanelProps {
  missingPrereqs: MissingPrereqResult[];
  recommendedPrereqs: RecommendedPrereqResult[];
  recommendedReasoning: Record<string, string>;
  installLog: string | null;
  installInProgress: boolean;
  includeRecommendations: boolean;
  onIncludeRecommendationsChange: (include: boolean) => void;
  onCopyCommand: (p: Prereq) => void;
  onInstall: (prereqId: string) => void;
  onOpenLink: (p: Prereq) => void;
  onInstallAllSafe: () => void;
  onInstallAllAdvanced: () => void;
  onRecheck: () => void;
}

export function PrerequisitesPanel({
  missingPrereqs,
  recommendedPrereqs,
  recommendedReasoning,
  installLog,
  installInProgress,
  includeRecommendations,
  onIncludeRecommendationsChange,
  onCopyCommand,
  onInstall,
  onOpenLink,
  onInstallAllSafe,
  onInstallAllAdvanced,
  onRecheck,
}: PrerequisitesPanelProps) {
  if (missingPrereqs.length === 0 && recommendedPrereqs.length === 0) return null;

  // Filter installable items (exclude blocked items)
  const wingetInstallable = missingPrereqs.filter(
    (r) => r.prereq.installMethod === "winget" && r.prereq.installCommandPowerShell && !r.blockedBy
  );
  const chocoInstallable = missingPrereqs.filter(
    (r) => r.prereq.installMethod === "choco" && r.prereq.installCommandPowerShell && !r.blockedBy
  );
  
  // Filter recommendations for installable items (exclude blocked items)
  const wingetRecommendations = recommendedPrereqs.filter(
    (r) => r.status === "missing" && r.prereq.installMethod === "winget" && r.prereq.installCommandPowerShell && !r.blockedBy
  );
  const chocoRecommendations = recommendedPrereqs.filter(
    (r) => r.status === "missing" && r.prereq.installMethod === "choco" && r.prereq.installCommandPowerShell && !r.blockedBy
  );
  
  const hasAdvancedInstallable = wingetInstallable.length > 0 || chocoInstallable.length > 0;

  return (
    <>
      {missingPrereqs.length > 0 && (
        <div className="message assistant prereqs-panel">
          <strong>Prerequisites</strong>
          <p className="muted">The following tools are missing. Install them before verifying.</p>
          <ul className="prereqs-list">
            {missingPrereqs.map((r) => {
              const p = r.prereq;
              const isBlocked = !!r.blockedBy;
              const canInstall = p.installCommandPowerShell && p.installMethod !== "manual" && !isBlocked;
              return (
                <li key={p.id} className="prereqs-item">
                  <span className="prereqs-name">{p.displayName}</span>
                  {r.reason && <span className="prereqs-reason muted"> — {r.reason}</span>}
                  {p.notes && <span className="prereqs-notes muted"> {p.notes}</span>}
                  {r.blockedBy && (
                    <span className="prereqs-blocked muted"> (Requires {r.blockedBy} first)</span>
                  )}
                  <div className="prereqs-actions">
                    {p.installCommandPowerShell && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => onCopyCommand(p)}
                        title="Copy install command"
                      >
                        Copy command
                      </button>
                    )}
                    {canInstall && (
                      <button
                        type="button"
                        className="btn btn-sm primary"
                        onClick={() => onInstall(p.id)}
                        disabled={installInProgress}
                        title="Run install"
                      >
                        Install
                      </button>
                    )}
                    {p.installUrl && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => onOpenLink(p)}
                        title="Open install page"
                      >
                        Open link
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="plan-actions">
            {wingetInstallable.length > 0 && (
              <button
                type="button"
                className="btn primary"
                onClick={onInstallAllSafe}
                disabled={installInProgress}
              >
                Install all (safe)
              </button>
            )}
            {hasAdvancedInstallable && (
              <button
                type="button"
                className="btn"
                onClick={onInstallAllAdvanced}
                disabled={installInProgress}
              >
                Install all (advanced)
              </button>
            )}
            <button type="button" className="btn" onClick={onRecheck}>
              Re-check
            </button>
          </div>
          {installLog && (
            <details className="prereqs-install-log">
              <summary>Install output</summary>
              <pre>{installLog}</pre>
            </details>
          )}
        </div>
      )}
      
      {recommendedPrereqs.length > 0 && (
        <div className="message assistant prereqs-panel recommendations-panel">
          <strong>Recommended CLIs</strong>
          <p className="muted">Helpful tools detected for your project. These are optional suggestions.</p>
          <ul className="prereqs-list">
            {recommendedPrereqs.map((r) => {
              const p = r.prereq;
              const reasoning = recommendedReasoning[p.id] || "";
              return (
                <li key={p.id} className="prereqs-item">
                  <span className={`prereqs-status ${r.status}`}>
                    {r.status === "installed" ? "✓" : "○"}
                  </span>
                  <span className="prereqs-name">{p.displayName}</span>
                  <span className={`prereqs-status-label ${r.status}`}>
                    {r.status === "installed" ? "Installed" : "Missing"}
                  </span>
                  {reasoning && <span className="prereqs-reason muted"> — {reasoning}</span>}
                  {r.status === "missing" && (
                    <div className="prereqs-actions">
                      {p.installCommandPowerShell && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => onCopyCommand(p)}
                          title="Copy install command"
                        >
                          Copy command
                        </button>
                      )}
                      {p.installCommandPowerShell && p.installMethod !== "manual" && !r.blockedBy && (
                        <button
                          type="button"
                          className="btn btn-sm primary"
                          onClick={() => onInstall(p.id)}
                          disabled={installInProgress}
                          title="Run install"
                        >
                          Install
                        </button>
                      )}
                      {r.blockedBy && (
                        <span className="prereqs-notes muted">
                          Requires {r.blockedBy} to install
                        </span>
                      )}
                      {p.installUrl && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => onOpenLink(p)}
                          title="Open install page"
                        >
                          Open link
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          
          {(wingetRecommendations.length > 0 || chocoRecommendations.length > 0) && (
            <div className="plan-actions">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={includeRecommendations}
                  onChange={(e) => onIncludeRecommendationsChange(e.target.checked)}
                />
                <span>Include recommendations in "Install all"</span>
              </label>
            </div>
          )}
        </div>
      )}
    </>
  );
}
