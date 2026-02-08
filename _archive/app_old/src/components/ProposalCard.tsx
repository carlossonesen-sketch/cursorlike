import type { PlanAndPatch } from "../core/types";

interface ProposalCardProps {
  plan: PlanAndPatch;
  changedFiles: string[];
  /** idle | patchProposed | patchApplied */
  appState: "idle" | "patchProposed" | "patchApplied";
  applyInProgress: boolean;
  /** When set, only View Diff (no Keep/Save later); Apply/Revert on timeline. */
  viewingSessionId?: string | null;
  onKeep: () => void;
  onRevert: () => void;
  onSaveLater: () => void;
  onViewDiff: () => void;
  showingDiff: boolean;
}

export function ProposalCard({
  plan,
  changedFiles,
  appState,
  applyInProgress,
  viewingSessionId,
  onKeep,
  onRevert,
  onSaveLater,
  onViewDiff,
  showingDiff,
}: ProposalCardProps) {
  const isPending = appState === "patchProposed";
  const isApplied = appState === "patchApplied";
  const viewing = Boolean(viewingSessionId);

  return (
    <div className="proposal-card">
      <div className="proposal-summary">
        <p className="proposal-explanation">{plan.explanation}</p>
        {changedFiles.length > 0 && (
          <p className="proposal-files muted">
            Files: {changedFiles.slice(0, 5).join(", ")}
            {changedFiles.length > 5 ? ` +${changedFiles.length - 5} more` : ""}
          </p>
        )}
      </div>
      <div className="proposal-actions">
        {viewing && (
          <button
            type="button"
            className="btn secondary"
            disabled={applyInProgress}
            onClick={onViewDiff}
          >
            {showingDiff ? "Hide diff" : "View Diff"}
          </button>
        )}
        {!viewing && isPending && (
          <>
            <button
              type="button"
              className="btn primary"
              disabled={applyInProgress}
              onClick={onKeep}
            >
              {applyInProgress ? "Applying…" : "Keep (Apply)"}
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={applyInProgress}
              onClick={onRevert}
            >
              Revert
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={applyInProgress}
              onClick={onSaveLater}
            >
              Save / Run later
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={applyInProgress}
              onClick={onViewDiff}
            >
              {showingDiff ? "Hide diff" : "View Diff"}
            </button>
          </>
        )}
        {!viewing && isApplied && (
          <>
            <span className="proposal-applied">Applied.</span>
            <button
              type="button"
              className="btn secondary"
              disabled={applyInProgress}
              onClick={onRevert}
            >
              {applyInProgress ? "Reverting…" : "Revert"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
