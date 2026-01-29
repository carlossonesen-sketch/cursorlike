/** Checks tab — Sprint 3 disabled. Stub only. */

interface ChecksTabProps {
  projectTypes: string[];
  logs: string;
  onRunChecks: () => void;
}

export function ChecksTab({
  projectTypes,
  logs,
  onRunChecks,
}: ChecksTabProps) {
  return (
    <div className="checks-tab">
      <p className="muted">Checks tab (Sprint 3) — disabled.</p>
      <h3>Project</h3>
      <p className="muted">Types: {projectTypes.length ? projectTypes.join(", ") : "—"}</p>
      <button
        type="button"
        className="btn secondary"
        disabled
        onClick={onRunChecks}
      >
        Run Checks (Sprint 3)
      </button>
      <h3>Logs</h3>
      <pre className="logs">{logs || "(no logs)"}</pre>
    </div>
  );
}
