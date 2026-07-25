import type { Dispatch, SetStateAction } from "react";
import type {
  FileTreeNode,
  ModelRolePaths,
  PlanAndPatch,
  FounderManifest,
  LivingBuildPlan,
  PlannerOutput,
  ProjectMemory,
  ProjectBlueprint,
  ProjectManifest,
  ProjectSnapshot,
  ReviewerOutput,
} from "../types";
import type { FileSnapshot } from "../patch/PatchEngine";
import type { LocalModelSettings } from "../runtime/runtimeApi";
import { ProjectInspector } from "../inspect/ProjectInspector";
import { getDefaultEnabledPackIds } from "../knowledge/autoEnablePacks";
import { detectProjectRoot } from "../project/projectRoot";
import { ProjectDetector } from "../project/ProjectDetector";
import { readProjectSnapshot, writeProjectSnapshot } from "../project/projectSnapshot";
import {
  generateSnapshotData,
  getSnapshotOutputPath,
  writeProjectSnapshotFile,
} from "../project/snapshot";
import { readWorkspaceSettings, writeWorkspaceSettings } from "../project/workspaceSettings";
import { readFounderManifest } from "../memory/founderManifestStore";
import { readLivingBuildPlan } from "../memory/buildPlanStore";
import { readProjectMemory } from "../memory/projectMemoryStore";
import { repairScaffoldCompletionIfNeeded } from "../memory/scaffoldRepair";
import { readWorkspaceProjectBlueprint } from "../product/projectBlueprintStore";
import {
  findToolRoot,
  resolveModelPath,
  scanModelsForGGUF,
  toolRootExists,
} from "../runtime/runtimeApi";
import type { WorkspaceService } from "./WorkspaceService";

type AppState = "idle" | "patchProposed" | "patchApplied";

interface WorkspaceInitializationOptions {
  workspace: WorkspaceService;
  workspacePathToOpen?: string;
  fetchSessionsAndResume: () => Promise<void>;
  setWorkspacePath: Dispatch<SetStateAction<string | null>>;
  setFileTree: Dispatch<SetStateAction<FileTreeNode[]>>;
  setManifest: Dispatch<SetStateAction<ProjectManifest | null>>;
  setPlanAndPatch: Dispatch<SetStateAction<PlanAndPatch | null>>;
  setPreviewMap: Dispatch<SetStateAction<Map<string, { old: string; new: string }> | null>>;
  setSelectedDiffPath: Dispatch<SetStateAction<string | null>>;
  setLastBeforeSnapshots: Dispatch<SetStateAction<FileSnapshot[] | null>>;
  setLastAppliedSessionId: Dispatch<SetStateAction<string | null>>;
  setCurrentProposedSessionId: Dispatch<SetStateAction<string | null>>;
  setViewingSessionId: Dispatch<SetStateAction<string | null>>;
  setAppState: Dispatch<SetStateAction<AppState>>;
  setStatusLine: Dispatch<SetStateAction<string | null>>;
  setShowDiffPanel: Dispatch<SetStateAction<boolean>>;
  setPlannerOutput: Dispatch<SetStateAction<PlannerOutput | null>>;
  setReviewerOutput: Dispatch<SetStateAction<ReviewerOutput | null>>;
  setLastRetrievedChunks: Dispatch<
    SetStateAction<{ title: string; sourcePath: string; chunkText: string }[]>
  >;
  setProjectSnapshot: Dispatch<SetStateAction<ProjectSnapshot | null>>;
  setProjectMemory: Dispatch<SetStateAction<ProjectMemory | null>>;
  setProjectBlueprint: Dispatch<SetStateAction<ProjectBlueprint | null>>;
  setLivingBuildPlan: Dispatch<SetStateAction<LivingBuildPlan | null>>;
  setFounderManifest: Dispatch<SetStateAction<FounderManifest | null>>;
  setEnabledPacks: Dispatch<SetStateAction<string[]>>;
  setAutoPacksEnabled: Dispatch<SetStateAction<boolean>>;
  setModelPath: Dispatch<SetStateAction<string | undefined>>;
  setModelRoles: Dispatch<SetStateAction<ModelRolePaths | undefined>>;
  setToolRoot: Dispatch<SetStateAction<string | null>>;
  setPort: Dispatch<SetStateAction<number>>;
  setLocalSettings: Dispatch<SetStateAction<LocalModelSettings>>;
  setSelectedPaths: Dispatch<SetStateAction<string[]>>;
}

export async function openWorkspaceWithInitialization({
  workspace,
  workspacePathToOpen,
  fetchSessionsAndResume,
  setWorkspacePath,
  setFileTree,
  setManifest,
  setPlanAndPatch,
  setPreviewMap,
  setSelectedDiffPath,
  setLastBeforeSnapshots,
  setLastAppliedSessionId,
  setCurrentProposedSessionId,
  setViewingSessionId,
  setAppState,
  setStatusLine,
  setShowDiffPanel,
  setPlannerOutput,
  setReviewerOutput,
  setLastRetrievedChunks,
  setProjectSnapshot,
  setProjectMemory,
  setProjectBlueprint,
  setLivingBuildPlan,
  setFounderManifest,
  setEnabledPacks,
  setAutoPacksEnabled,
  setModelPath,
  setModelRoles,
  setToolRoot,
  setPort,
  setLocalSettings,
  setSelectedPaths,
}: WorkspaceInitializationOptions): Promise<void> {
  const path = workspacePathToOpen ?? await workspace.openWorkspace();
  if (!path) return;
  if (workspacePathToOpen) {
    await workspace.setWorkspaceRoot(workspacePathToOpen);
  }
  setWorkspacePath(path);
  setProjectSnapshot(null);
  setProjectMemory(null);
  setProjectBlueprint(null);
  setLivingBuildPlan(null);
  setFounderManifest(null);
  setEnabledPacks([]);
  setToolRoot(null);
  setStatusLine("Scanning workspaceâ€¦");
  try {
    const root = workspace.root ?? path;
    let [projectMemory, livingBuildPlan, founderManifest, projectBlueprint] = await Promise.all([
      readProjectMemory(root),
      readLivingBuildPlan(root),
      readFounderManifest(root),
      readWorkspaceProjectBlueprint(root),
    ]);
    const repaired = await repairScaffoldCompletionIfNeeded(root, workspace, projectMemory, livingBuildPlan);
    projectMemory = repaired.projectMemory;
    livingBuildPlan = repaired.livingBuildPlan;
    setProjectMemory(projectMemory);
    setProjectBlueprint(projectBlueprint);
    setLivingBuildPlan(livingBuildPlan);
    setFounderManifest(founderManifest);

    const projectRootResult = await detectProjectRoot(root);
    console.log(
      "[init] project root:",
      projectRootResult.rootPath,
      "type:",
      projectRootResult.detectedType,
      "signals:",
      projectRootResult.signalsFound
    );

    const inspector = new ProjectInspector(workspace);
    const m = await inspector.buildManifest();
    setManifest(m);
    const tree = await workspace.readFileTree();
    setFileTree(tree);
    const detector = new ProjectDetector(workspace);
    const detected = await detector.detect();
    const settings = await readWorkspaceSettings(root);

    const availablePacks = [
      ...new Set([
        ...detected.recommendedPacks,
        "powershell",
        "python",
        "typescript",
        "javascript",
        "node",
        "rust",
      ]),
    ];
    const defaultPacks = !settings.enabledPacks?.length
      ? getDefaultEnabledPackIds(projectRootResult, availablePacks)
      : settings.enabledPacks;
    const enabled = settings.autoPacksEnabled
      ? settings.enabledPacks?.length
        ? settings.enabledPacks
        : defaultPacks
      : settings.enabledPacks?.length
        ? settings.enabledPacks
        : defaultPacks;
    console.log("[init] enabled packs:", enabled);

    const existingSnapshot = await readProjectSnapshot(root);
    const snapshotPath = getSnapshotOutputPath(root);
    const existingAge = existingSnapshot?.generatedAt
      ? (Date.now() - new Date(existingSnapshot.generatedAt).getTime()) / 3600000
      : Infinity;
    const needsSnapshot = !existingSnapshot || existingAge > 24;
    if (needsSnapshot) {
      console.log("[init] generating snapshot (missing or >24h old), path:", snapshotPath);
      const fullSnapshot = await generateSnapshotData(
        root,
        projectRootResult.detectedType,
        projectRootResult.signalsFound,
        {
          detectedTypes: detected.detectedTypes,
          recommendedPacks: detected.recommendedPacks,
          importantFiles: detected.importantFiles,
          detectedCommands: detected.detectedCommands,
          enabledPacks: enabled,
        }
      );
      await writeProjectSnapshotFile(root, fullSnapshot);
    } else {
      console.log("[init] snapshot fresh, path:", snapshotPath);
    }

    const tr = await findToolRoot(root);
    setToolRoot(tr);
    setPort(settings.port ?? 11435);
    let modelPathNext = settings.modelPath?.trim() || undefined;
    if (tr) {
      const missing = !modelPathNext || !(await toolRootExists(tr, modelPathNext));
      if (missing) {
        const scanned = await scanModelsForGGUF(tr);
        if (scanned) modelPathNext = scanned;
      }
    }
    const newSettings = {
      autoPacksEnabled: settings.autoPacksEnabled,
      enabledPacks: enabled,
      modelPath: modelPathNext,
      port: settings.port ?? 11435,
      modelRoles: settings.modelRoles,
    };
    await writeWorkspaceSettings(root, newSettings);
    setModelPath(modelPathNext);
    setModelRoles(settings.modelRoles ?? undefined);
    const ggufPathFromRoles = settings.modelRoles?.coder ?? settings.modelRoles?.general;
    const ggufPath =
      ggufPathFromRoles ?? (modelPathNext && tr ? resolveModelPath(tr, modelPathNext) : "");
    setLocalSettings((prev) => ({
      ...prev,
      ggufPath: ggufPath || "",
    }));
    const snapshot: ProjectSnapshot = {
      detectedTypes: detected.detectedTypes,
      recommendedPacks: detected.recommendedPacks,
      enabledPacks: enabled,
      importantFiles: detected.importantFiles,
      detectedCommands: detected.detectedCommands,
    };
    await writeProjectSnapshot(root, snapshot);
    setProjectSnapshot(snapshot);
    setEnabledPacks(enabled);
    setAutoPacksEnabled(settings.autoPacksEnabled);
    await fetchSessionsAndResume();
  } catch (e) {
    console.error("openWorkspace", e);
  } finally {
    setStatusLine(null);
  }
  setPlanAndPatch(null);
  setPreviewMap(null);
  setPlannerOutput(null);
  setReviewerOutput(null);
  setLastRetrievedChunks([]);
  setSelectedPaths([]);
  setSelectedDiffPath(null);
  setLastBeforeSnapshots(null);
  setLastAppliedSessionId(null);
  setCurrentProposedSessionId(null);
  setViewingSessionId(null);
  setAppState("idle");
  setShowDiffPanel(false);
}
