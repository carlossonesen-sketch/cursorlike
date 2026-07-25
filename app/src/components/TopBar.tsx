import type { ReactNode } from "react";
import { TopMenu, type NFMode } from "./TopMenu";

interface TopBarProps {
  workspacePath: string | null;
  onOpenWorkspace: () => void;
  onCreateNewProject: () => void;
  onImportExistingProject: () => void;
  activeMode: NFMode;
  onModeChange: (mode: NFMode) => void;
  children?: ReactNode;
}

export function TopBar({ workspacePath, onOpenWorkspace, onCreateNewProject, onImportExistingProject, activeMode, onModeChange, children }: TopBarProps) {
  return (
    <div className="topbar">
      <TopMenu
        activeMode={activeMode}
        onModeChange={onModeChange}
        onOpenProject={onOpenWorkspace}
        onCreateNewProject={onCreateNewProject}
        onImportExistingProject={onImportExistingProject}
      />
      <button type="button" className="btn primary" onClick={onOpenWorkspace}>
        Open Workspace
      </button>
      <span className="active-mode-pill" title={`Current mode: ${activeMode}`}>
        {activeMode}
      </span>
      <span className="workspace-path" title={workspacePath ?? ""}>
        {workspacePath ? workspacePath : "No workspace open"}
      </span>
      {children}
    </div>
  );
}
