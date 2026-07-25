import type { ReactNode } from "react";

export type NFMode = "Chat" | "Plan" | "Code" | "Debug" | "Diagnose" | "Auto";

interface TopMenuProps {
  activeMode: NFMode;
  onModeChange: (mode: NFMode) => void;
  onOpenProject: () => void;
  onCreateNewProject: () => void;
  onImportExistingProject: () => void;
}

const MODES: NFMode[] = ["Chat", "Plan", "Code", "Debug", "Diagnose", "Auto"];

function MenuGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <details className="top-menu-group">
      <summary>{label}</summary>
      <div className="top-menu-dropdown">{children}</div>
    </details>
  );
}

function MenuItem({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button type="button" className="top-menu-item" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

export function TopMenu({ activeMode, onModeChange, onOpenProject, onCreateNewProject, onImportExistingProject }: TopMenuProps) {
  return (
    <nav className="top-menu" aria-label="NF menu">
      <MenuGroup label="Project">
        <MenuItem onClick={onOpenProject}>Open Project</MenuItem>
        <MenuItem onClick={onCreateNewProject}>Create New Project</MenuItem>
        <MenuItem onClick={onImportExistingProject}>Import Existing Project</MenuItem>
        <MenuItem disabled>Recent Projects <span>Coming later</span></MenuItem>
        <MenuItem disabled>Project Memory <span>Coming later</span></MenuItem>
        <MenuItem disabled>Global Memory <span>Coming later</span></MenuItem>
        <MenuItem disabled>Project Settings <span>Coming later</span></MenuItem>
      </MenuGroup>

      <MenuGroup label="Mode">
        {MODES.map((mode) => (
          <MenuItem key={mode} onClick={() => onModeChange(mode)}>
            {mode}
            {mode === activeMode && <span>Active</span>}
          </MenuItem>
        ))}
      </MenuGroup>

      <MenuGroup label="Model">
        <MenuItem>OpenAI <span>Default</span></MenuItem>
        <MenuItem disabled>Claude <span>Coming later</span></MenuItem>
        <MenuItem disabled>Gemini <span>Coming later</span></MenuItem>
        <MenuItem disabled>DeepSeek <span>Coming later</span></MenuItem>
        <MenuItem disabled>Grok/xAI <span>Coming later</span></MenuItem>
        <MenuItem disabled>Local Llama <span>Coming later</span></MenuItem>
      </MenuGroup>

      <MenuGroup label="Developer">
        <MenuItem disabled>Run Checks <span>Placeholder</span></MenuItem>
        <MenuItem disabled>Format Project <span>Placeholder</span></MenuItem>
        <MenuItem disabled>Search Files <span>Placeholder</span></MenuItem>
        <MenuItem disabled>View Action Log <span>Placeholder</span></MenuItem>
        <MenuItem disabled>Developer Diagnostics <span>Placeholder</span></MenuItem>
      </MenuGroup>

      <MenuGroup label="Tools">
        <MenuItem disabled>Generate Summary <span>Placeholder</span></MenuItem>
        <MenuItem disabled>Export Plan <span>Placeholder</span></MenuItem>
      </MenuGroup>

      <MenuGroup label="View">
        <MenuItem disabled>Focus Conversation <span>Placeholder</span></MenuItem>
        <MenuItem disabled>Toggle Patch Preview <span>Placeholder</span></MenuItem>
      </MenuGroup>

      <MenuGroup label="Help">
        <MenuItem disabled>Getting Started <span>Coming later</span></MenuItem>
        <MenuItem disabled>Keyboard Shortcuts <span>Coming later</span></MenuItem>
        <MenuItem disabled>About NF <span>Coming later</span></MenuItem>
      </MenuGroup>
    </nav>
  );
}
