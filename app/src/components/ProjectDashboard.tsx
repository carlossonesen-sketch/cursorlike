import React from "react";
import type { ProjectDashboardModel } from "../core/project/projectDashboard";

void React;

interface ProjectDashboardProps {
  dashboard: ProjectDashboardModel;
  onClose: () => void;
  developerMode?: boolean;
}

function Field({ label, value }: { label: string; value: string | number }) {
  return (
    <p>
      <span>{label}</span>
      {value}
    </p>
  );
}

export function ProjectDashboard({ dashboard, onClose, developerMode = false }: ProjectDashboardProps) {
  return (
    <div className="project-dashboard" role="region" aria-label="Project Dashboard">
      <div className="project-dashboard-header">
        <div>
          <strong>Project Dashboard</strong>
          <span>{dashboard.projectPulse.projectName}</span>
        </div>
        <button type="button" className="btn secondary small" onClick={onClose}>
          Back to Chat
        </button>
      </div>

      <section>
        <h3>Current Phase</h3>
        {dashboard.currentPhase.emptyState ? (
          <p className="project-dashboard-empty">{dashboard.currentPhase.emptyState}</p>
        ) : (
          <div className="project-dashboard-grid">
            <Field label="Phase" value={dashboard.currentPhase.phaseName} />
            <Field label="Status" value={dashboard.currentPhase.phaseStatus} />
            <Field label="Task" value={dashboard.currentPhase.currentTask} />
            <Field label="Next" value={dashboard.currentPhase.nextRecommendedAction} />
            {developerMode && dashboard.currentPhase.phaseId && (
              <Field label="Phase ID" value={dashboard.currentPhase.phaseId} />
            )}
            {developerMode && dashboard.currentPhase.taskId && (
              <Field label="Task ID" value={dashboard.currentPhase.taskId} />
            )}
          </div>
        )}
      </section>

      <section>
        <h3>Phase Confidence</h3>
        {dashboard.phaseConfidence.emptyState ? (
          <p className="project-dashboard-empty">{dashboard.phaseConfidence.emptyState}</p>
        ) : (
          <div className="project-dashboard-grid">
            <Field label="Confidence" value={dashboard.phaseConfidence.level} />
            <Field label="Summary" value={dashboard.phaseConfidence.summary} />
            {developerMode && <Field label="Details" value={dashboard.phaseConfidence.detail} />}
          </div>
        )}
      </section>

      <section>
        <h3>Quality Gate Status</h3>
        <div className="project-dashboard-grid">
          <Field label="Status" value={dashboard.qualityGateStatus.status} />
          <Field label="Reason" value={dashboard.qualityGateStatus.reason} />
          {developerMode && <Field label="Details" value={dashboard.qualityGateStatus.detail} />}
        </div>
      </section>

      <section>
        <h3>Next Task</h3>
        <div className="project-dashboard-grid">
          <Field label="Task" value={dashboard.nextTask.title} />
          <Field label="Why next" value={dashboard.nextTask.reason} />
          <Field label="Status" value={dashboard.nextTask.status} />
          {developerMode && <Field label="Source" value={dashboard.nextTask.source} />}
          {developerMode && dashboard.nextTask.taskId && <Field label="Task ID" value={dashboard.nextTask.taskId} />}
          {developerMode && dashboard.nextTask.phaseId && <Field label="Phase ID" value={dashboard.nextTask.phaseId} />}
          {developerMode && dashboard.nextTask.phaseTitle && <Field label="Phase" value={dashboard.nextTask.phaseTitle} />}
          {developerMode && dashboard.nextTask.blockerInfo && <Field label="Blocker" value={dashboard.nextTask.blockerInfo} />}
          {developerMode && <Field label="Selection" value={dashboard.nextTask.selectionReason} />}
        </div>
      </section>

      <section>
        <h3>Blockers</h3>
        <div className="project-dashboard-grid">
          <Field label="Count" value={dashboard.blockers.count} />
          <Field label="Summary" value={dashboard.blockers.summary} />
          {dashboard.blockers.items.map((blocker, index) => (
            <Field
              key={blocker.id}
              label={`Blocker ${index + 1}`}
              value={`${blocker.severity} / ${blocker.status}: ${blocker.title}`}
            />
          ))}
          {developerMode && dashboard.blockers.items.map((blocker, index) => (
            <Field
              key={`${blocker.id}-detail`}
              label={`Blocker ${index + 1} details`}
              value={[
                `source=${blocker.source}`,
                `id=${blocker.id}`,
                `message=${blocker.message}`,
                `phase=${blocker.phaseId ?? "(none)"}`,
                `task=${blocker.taskId ?? "(none)"}`,
                `check=${blocker.checkKind ?? "(none)"}`,
                `repairs=${blocker.repairAttempts ?? "(none)"}`,
              ].join("; ")}
            />
          ))}
        </div>
      </section>

      <section>
        <h3>Mode State</h3>
        <div className="project-dashboard-grid">
          <Field label="Mode" value={dashboard.modeState.currentMode} />
          <Field label="Meaning" value={dashboard.modeState.explanation} />
          <Field label="Developer details hidden" value={dashboard.modeState.developerDetailsHidden} />
          {developerMode && <Field label="Raw mode detail" value={dashboard.modeState.rawDetail} />}
        </div>
      </section>

      <section>
        <h3>Architecture Review</h3>
        {dashboard.architectureReview.emptyState ? (
          <p className="project-dashboard-empty">{dashboard.architectureReview.emptyState}</p>
        ) : (
          <div className="project-dashboard-grid">
            <Field label="Status" value={dashboard.architectureReview.status} />
            <Field label="Score" value={dashboard.architectureReview.score} />
            <Field label="Summary" value={dashboard.architectureReview.summary} />
            <Field label="Critical findings" value={dashboard.architectureReview.criticalFindings} />
            <Field label="Approvals" value={dashboard.architectureReview.approvalRequired} />
            {developerMode && <Field label="Improvements" value={dashboard.architectureReview.recommendedImprovements} />}
            {developerMode && <Field label="Raw architecture detail" value={dashboard.architectureReview.rawDetail} />}
          </div>
        )}
      </section>

      <section>
        <h3>Project Health</h3>
        {dashboard.projectHealth.emptyState ? (
          <p className="project-dashboard-empty">{dashboard.projectHealth.emptyState}</p>
        ) : (
          <div className="project-dashboard-grid">
            <Field label="Overall score" value={dashboard.projectHealth.overallScore} />
            <Field label="Status" value={dashboard.projectHealth.overallStatus} />
            <Field label="Top risks" value={dashboard.projectHealth.topRisks} />
            <Field label="Top strengths" value={dashboard.projectHealth.topStrengths} />
            <Field label="Next recommendation" value={dashboard.projectHealth.nextRecommendation} />
            {developerMode && <Field label="Raw health detail" value={dashboard.projectHealth.rawDetail} />}
          </div>
        )}
      </section>

      <section>
        <h3>Risk Summary</h3>
        <div className="project-dashboard-grid">
          <Field label="Summary" value={dashboard.riskSummary.summary} />
          <Field label="Top risks" value={dashboard.riskSummary.topRisks} />
          <Field label="Blockers" value={dashboard.riskSummary.blockerCount} />
          <Field label="Architecture" value={dashboard.riskSummary.architectureRisk} />
          <Field label="Health" value={dashboard.riskSummary.healthRisk} />
          {developerMode && <Field label="Raw risk detail" value={dashboard.riskSummary.rawDetail} />}
        </div>
      </section>

      <section>
        <h3>Project Pulse</h3>
        <div className="project-dashboard-grid">
          <Field label="Project" value={dashboard.projectPulse.projectName} />
          <Field label="Path" value={dashboard.projectPulse.projectPath} />
          <Field label="Build" value={dashboard.projectPulse.buildStatus} />
          <Field label="Critical issues" value={dashboard.projectPulse.criticalIssuesCount} />
          <Field label="Current task" value={dashboard.projectPulse.currentTask} />
          <Field label="Next milestone" value={dashboard.projectPulse.nextMilestone} />
          <Field label="MVP time" value={dashboard.projectPulse.estimatedMvpTime} />
          <Field label="Confidence" value={dashboard.projectPulse.overallConfidence} />
        </div>
      </section>

      <section>
        <h3>Progress Layers</h3>
        <div className="project-dashboard-grid">
          <Field label="Development" value={dashboard.progressLayers.developmentProgress} />
          <Field label="Founder MVP" value={dashboard.progressLayers.founderMvpProgress} />
          <Field label="Vision" value={dashboard.progressLayers.productVisionProgress} />
          <Field label="Quality" value={dashboard.progressLayers.qualityProgress} />
          <Field label="Launch" value={dashboard.progressLayers.launchReadiness} />
        </div>
      </section>

      <section>
        <h3>Current Work</h3>
        <div className="project-dashboard-grid">
          <Field label="Phase" value={dashboard.currentWork.developmentPhase} />
          <Field label="Task" value={dashboard.currentWork.currentTask} />
          <Field label="Completed" value={dashboard.currentWork.completedTasks} />
          <Field label="Blocked" value={dashboard.currentWork.blockedTasks} />
          <Field label="Next" value={dashboard.currentWork.nextRecommendedStep} />
        </div>
      </section>

      <section>
        <h3>Founder Decisions</h3>
        <div className="project-dashboard-grid">
          <Field label="Approved" value={dashboard.founderDecisions.approvedDecisions} />
          <Field label="Pending" value={dashboard.founderDecisions.pendingDecisions} />
        </div>
      </section>

      <section>
        <h3>CTO Recommendation</h3>
        <div className="project-dashboard-grid">
          <Field label="Priority 1" value={dashboard.ctoRecommendation.priority1} />
          <Field label="Priority 2" value={dashboard.ctoRecommendation.priority2} />
          <Field label="Priority 3" value={dashboard.ctoRecommendation.priority3} />
          <Field label="Next milestone" value={dashboard.ctoRecommendation.estimatedTimeToNextMilestone} />
          <Field label="Confidence" value={dashboard.ctoRecommendation.confidenceScore} />
        </div>
      </section>
    </div>
  );
}
