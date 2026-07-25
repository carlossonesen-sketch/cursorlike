import type { DiscoveryIntake, IntakeAnswer } from "../core/types";
import { isMaterialIntakeQuestion } from "../core/product/discoveryIntake";

interface DiscoveryIntakeCardProps {
  intake: DiscoveryIntake;
  developerMode?: boolean;
  needsProjectName?: boolean;
  projectName?: string;
  onContinueWithDefaults: () => void;
}

function answerValue(intake: DiscoveryIntake, key: string): string {
  return intake.inferredAnswers.find((answer) => answer.key === key)?.value ?? "Not inferred yet";
}

function defaultValue(intake: DiscoveryIntake, key: string): string {
  return intake.recommendedDefaults.find((item) => item.key === key)?.value ?? "NF will choose a safe default.";
}

function sourceLabel(source: IntakeAnswer["source"]): string {
  if (source === "user") return "You specified this";
  if (source === "inferred") return "NF inferred this";
  return "NF defaulted this";
}

function reasonForAnswer(answer: IntakeAnswer): string {
  if (answer.key === "productType") {
    return answer.source === "default"
      ? "The request did not name a specific product category, so NF will start with a general software product."
      : "The wording in your request points to this product category.";
  }
  if (answer.key === "platform") {
    return answer.source === "user"
      ? "The platform was named in your request."
      : "Web is the safest first platform because it is fastest to build, demo, test, and share.";
  }
  if (answer.key === "mvpFeatures") {
    return "These are the smallest useful features NF can plan around first.";
  }
  if (answer.key === "accounts") {
    return answer.source === "user"
      ? "Your request mentions users, accounts, or login."
      : "Leaving accounts until later keeps the first MVP faster unless the product needs multiple users now.";
  }
  if (answer.key === "storage") {
    return "Storage is chosen to match the smallest practical MVP scope.";
  }
  if (answer.key === "charts") {
    return "Charts are included only where they help the core workflow.";
  }
  if (answer.key === "mobileApps") {
    return answer.source === "user"
      ? "Your request specifically mentions mobile app targets."
      : "Mobile apps can come later after the first web MVP is validated.";
  }
  return "NF will use this as a planning assumption unless you change it.";
}

function displayText(value: string, maxLength = 900): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trim()}... (${normalized.length - maxLength} more characters hidden in the UI; full text is preserved for planning.)`;
}

export function DiscoveryIntakeCard({
  intake,
  developerMode = false,
  needsProjectName = false,
  projectName,
  onContinueWithDefaults,
}: DiscoveryIntakeCardProps) {
  const nonBlockingQuestions = intake.unansweredQuestions.filter((question) => !question.blocksBuild);
  const materialQuestions = intake.unansweredQuestions.filter(isMaterialIntakeQuestion);
  const materialBlockingQuestions = materialQuestions.filter((question) => question.blocksBuild);
  const visibleQuestions = materialBlockingQuestions.length ? materialBlockingQuestions : materialQuestions;
  const canContinue = materialBlockingQuestions.length === 0 && !needsProjectName;
  const productType = answerValue(intake, "productType");
  const platform = answerValue(intake, "platform");
  const mvpDirection = answerValue(intake, "mvpFeatures");
  const accountsDefault = answerValue(intake, "accounts");
  const targetUsers = nonBlockingQuestions.find((question) => question.key === "audience")?.recommendedDefault ?? "first MVP users";
  const continueAssumption = intake.assumptions.find((assumption) => /safest practical defaults/i.test(assumption)) ??
    "NF will use safe defaults for unanswered questions.";

  return (
    <section className="discovery-intake-card" aria-label="Discovery intake">
      <div className="discovery-intake-header">
        <div>
          <strong>Discovery Intake</strong>
          <p>{intake.understoodSummary}</p>
          {needsProjectName && (
            <p className="intake-name-required">
              NF still needs a project name before planning can continue.
              {projectName && !projectName.toLowerCase().includes("untitled")
                ? ` Current label: ${projectName}.`
                : " Add `Project Name: Your Project Name` to your idea or tell NF in chat."}
            </p>
          )}
        </div>
        <span className={`intake-confidence intake-confidence-${intake.confidenceLevel}`}>
          {intake.confidenceLevel} confidence
        </span>
      </div>

      <div className="intake-understood-summary" aria-label="What NF understood">
        <h4>What NF understood</h4>
        <p>
          You want to build <strong>{productType}</strong>. NF will treat this as a <strong>{platform}</strong> first,
          with an MVP focused on <strong>{mvpDirection}</strong>.
        </p>
        <dl>
          <div>
            <dt>Product idea</dt>
            <dd>{intake.userRequest ? displayText(intake.userRequest) : "No idea text entered yet."}</dd>
          </div>
          <div>
            <dt>Target users</dt>
            <dd>{targetUsers}</dd>
          </div>
          <div>
            <dt>Platform default</dt>
            <dd>{platform || defaultValue(intake, "platform")}</dd>
          </div>
          <div>
            <dt>MVP direction</dt>
            <dd>{mvpDirection}</dd>
          </div>
          <div>
            <dt>If you continue</dt>
            <dd>{continueAssumption} Accounts are set to {accountsDefault}.</dd>
          </div>
        </dl>
      </div>

      <div className="discovery-intake-grid">
        <div className="intake-panel">
          <h4>What NF inferred</h4>
          <dl className="inferred-answer-list">
            {intake.inferredAnswers.map((answer) => (
              <div key={answer.key} className="inferred-answer-row">
                <dt>
                  {answer.label}
                  <span className={`intake-source-pill intake-source-${answer.source}`}>
                    {sourceLabel(answer.source)}
                  </span>
                </dt>
                <dd>
                  <strong>{answer.value}</strong>
                  <span className="intake-answer-confidence">{answer.confidence} confidence</span>
                  <span className="intake-answer-reason">{reasonForAnswer(answer)}</span>
                  {developerMode && (
                    <span className="intake-source">
                      key: {answer.key}; source: {answer.source}; confidence: {answer.confidence}
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="intake-panel">
          <h4>Recommended defaults</h4>
          <p className="intake-defaults-note">If you skip the optional questions, NF will use these defaults and keep moving.</p>
          <dl className="recommended-default-list">
            {intake.recommendedDefaults.map((item) => (
              <div key={item.key} className="recommended-default-row">
                <dt>
                  {item.label}
                  <span className="intake-default-pill">Used if skipped</span>
                </dt>
                <dd>
                  <strong>{item.value}</strong>
                  <span className="intake-reason">{item.reason}</span>
                  {developerMode && <span className="intake-source">key: {item.key}</span>}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <div className="intake-panel">
        <h4>{materialBlockingQuestions.length ? "Questions before NF can continue" : "Material questions"}</h4>
        {visibleQuestions.length ? (
          <ul className="intake-question-list">
            {visibleQuestions.map((question) => (
              <li key={question.key}>
                <strong>{question.question}</strong>
                <span>Default: {question.recommendedDefault}</span>
                {developerMode && (
                  <small>
                    {question.whyItMatters}
                    {question.blocksBuild ? " This blocks the build." : " This does not block the build."}
                  </small>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="intake-question-empty">No material questions need an answer before NF can continue.</p>
        )}
      </div>

      {developerMode && (
        <div className="discovery-intake-grid">
          <div className="intake-panel">
            <h4>Assumptions</h4>
            <ul>
              {intake.assumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ul>
          </div>
          <div className="intake-panel">
            <h4>Confirm later</h4>
            <ul>
              {intake.decisionsRequiringLaterConfirmation.map((decision) => (
                <li key={decision}>{decision}</li>
              ))}
            </ul>
          </div>
          <div className="intake-panel intake-developer-questions">
            <h4>All intake questions</h4>
            <ul className="intake-question-list">
              {intake.unansweredQuestions.map((question) => (
                <li key={question.key}>
                  <strong>{question.question}</strong>
                  <span>{isMaterialIntakeQuestion(question) ? "Material" : "Developer detail"}</span>
                  <small>
                    {question.whyItMatters}
                    {question.blocksBuild ? " This blocks the build." : " This does not block the build."}
                  </small>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="discovery-intake-actions">
        <button
          type="button"
          className="btn primary"
          disabled={!canContinue}
          onClick={canContinue ? onContinueWithDefaults : undefined}
        >
          {needsProjectName
            ? "Add a project name first"
            : canContinue
              ? "Continue with NF defaults"
              : "Answer required questions first"}
        </button>
        {needsProjectName ? (
          <span className="intake-blocked">
            NF will not create a build plan until this project has a real name. No files are created yet.
          </span>
        ) : canContinue ? (
          <span className="intake-continue-note">
            NF will use the defaults above for skipped questions. No files are created yet.
          </span>
        ) : (
          <span className="intake-blocked">NF needs the blocking answers before it can create a Blueprint.</span>
        )}
      </div>
    </section>
  );
}
