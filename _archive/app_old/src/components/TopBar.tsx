import type { ReactNode } from "react";

interface TopBarProps {
  workspacePath: string | null;
  onOpenWorkspace: () => void;
  children?: ReactNode;
}

export function TopBar({ workspacePath, onOpenWorkspace, children }: TopBarProps) {
  return (
    <div className="topbar">
      <button type="button" className="btn primary" onClick={onOpenWorkspace}>
        Open Workspace
      </button>
      <span className="workspace-path" title={workspacePath ?? ""}>
        {workspacePath ? workspacePath : "No workspace open"}
      </span>
      {children}
    </div>
  );
}
