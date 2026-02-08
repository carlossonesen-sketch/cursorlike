interface DebugPanelProps {
  workspaceRoot: string | null;
  selectedFilesCount: number;
  hasProposedPatch: boolean;
  lastSessionId: string | null;
}

export function DebugPanel({
  workspaceRoot,
  selectedFilesCount,
  hasProposedPatch,
  lastSessionId,
}: DebugPanelProps) {
  return (
    <div className="debug-panel">
      <h4>Debug</h4>
      <pre>
        workspaceRoot: {workspaceRoot ?? "(null)"}
        {"\n"}selectedFiles: {selectedFilesCount}
        {"\n"}hasProposedPatch: {String(hasProposedPatch)}
        {"\n"}lastSessionId: {lastSessionId ?? "(null)"}
      </pre>
    </div>
  );
}
