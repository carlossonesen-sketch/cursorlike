export function founderHeadlineForChangeApproval(): string {
  return "NF is ready to make the next file change.";
}

export function founderWaitingForChangeApproval(): string {
  return "Waiting for you to approve the change.";
}

export function founderChangePrepared(): string {
  return "NF prepared a file change.";
}

export function founderChangeApprovedApplying(): string {
  return "Change approved. Applying it now.";
}

export function founderRunningChecks(): string {
  return "Running checks.";
}

export function describeWhatWillChange(filePaths: string[], taskTitle: string): string {
  if (filePaths.length === 0) {
    return `NF will update project files for "${taskTitle}".`;
  }
  if (filePaths.length === 1) {
    return `NF will update ${filePaths[0]} for "${taskTitle}".`;
  }
  return `NF will update ${filePaths.slice(0, 3).join(", ")}${filePaths.length > 3 ? ` and ${filePaths.length - 3} more file(s)` : ""} for "${taskTitle}".`;
}

export function founderSummaryFromPending(input: {
  taskTitle: string;
  filePaths: string[];
  explanation: string;
}): string {
  return [
    describeWhatWillChange(input.filePaths, input.taskTitle),
    input.explanation.trim(),
  ].filter(Boolean).join(" ");
}

export function isPatchApprovalBlockerText(text?: string | null): boolean {
  if (!text) return false;
  return (
    /Approval required:/i.test(text) ||
    /Patch application requires approval/i.test(text) ||
    (/patch/i.test(text) && /control level/i.test(text))
  );
}

export function sanitizeFounderExecutionText(text: string): string {
  return text
    .replace(/\bpatch(es)?\b/gi, "change")
    .replace(/\bcontrol level\b/gi, "safety setting")
    .replace(/\bplanner lock\b/gi, "project plan")
    .replace(/\bPhasePatchProvider\b/g, "model provider");
}
