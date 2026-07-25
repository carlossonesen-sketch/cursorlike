import { useCallback, useEffect, useRef } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { ModelRolePaths, WorkspaceSettings } from "../types";
import {
  MockModelProvider,
  setModelProvider,
} from "../model/ModelGateway";
import { LocalModelProvider } from "../model/LocalModelProvider";
import { readWorkspaceSettings, writeWorkspaceSettings } from "../project/workspaceSettings";
import { OpenAIModelProvider } from "../../lib/providers/openai";
import type { WorkspaceService } from "../workspace/WorkspaceService";
import {
  ensureLocalRuntime,
  findToolRoot,
  pathExists,
  resolveModelPath,
  runtimeStatus,
  scanModelsForGGUF,
  toolRootExists,
} from "./runtimeApi";
import type { LocalModelSettings, Provider } from "./runtimeApi";

interface RuntimeControllerOptions {
  workspace: WorkspaceService;
  workspacePath: string | null;
  provider: Provider;
  localSettings: LocalModelSettings;
  modelRoles: ModelRolePaths | undefined;
  toolRoot: string | null;
  port: number;
  runtimePort: number | null;
  setModelPath: Dispatch<SetStateAction<string | undefined>>;
  setModelRoles: Dispatch<SetStateAction<ModelRolePaths | undefined>>;
  setToolRoot: Dispatch<SetStateAction<string | null>>;
  setRuntimePort: Dispatch<SetStateAction<number | null>>;
  setGgufPathMissing: Dispatch<SetStateAction<string | null>>;
  setLocalSettings: Dispatch<SetStateAction<LocalModelSettings>>;
}

interface RuntimeControllerResult {
  localSettingsRef: MutableRefObject<LocalModelSettings>;
  toolRootRef: MutableRefObject<string | null>;
  portRef: MutableRefObject<number>;
  runtimePortRef: MutableRefObject<number | null>;
  pickGGUFFile: () => Promise<void>;
  rescanModels: () => Promise<void>;
  onModelRolesChange: (roles: ModelRolePaths) => Promise<void>;
}

export function useRuntimeController({
  workspace,
  workspacePath,
  provider,
  localSettings,
  modelRoles,
  toolRoot,
  port,
  runtimePort,
  setModelPath,
  setModelRoles,
  setToolRoot,
  setRuntimePort,
  setGgufPathMissing,
  setLocalSettings,
}: RuntimeControllerOptions): RuntimeControllerResult {
  const localSettingsRef = useRef(localSettings);
  const toolRootRef = useRef<string | null>(null);
  const portRef = useRef<number>(11435);
  const runtimePortRef = useRef<number | null>(null);
  localSettingsRef.current = localSettings;
  toolRootRef.current = toolRoot;
  portRef.current = port;
  runtimePortRef.current = runtimePort;

  useEffect(() => {
    if (provider === "local") {
      setModelProvider(
        new LocalModelProvider(
          () => localSettingsRef.current,
          () => toolRootRef.current,
          () => runtimePortRef.current ?? portRef.current ?? 11435,
          () => ({})
        ),
        { kind: "local", label: "Local model", isReal: true, available: true }
      );
    } else if (provider === "openai") {
      setModelProvider(
        new OpenAIModelProvider(),
        { kind: "openai", label: "OpenAI (backend)", isReal: true, available: true }
      );
    } else {
      setModelProvider(
        new MockModelProvider(),
        {
          kind: "mock",
          label: "Mock (development only)",
          isReal: false,
          available: true,
          reason: "Mock output is never applyable in Developer Mode.",
        }
      );
    }
  }, [provider, runtimePort]);

  const runLocalModelAutoScan = useCallback(async () => {
    const root = workspace.root;
    if (!root) return;
    const tr = await findToolRoot(root);
    if (!tr) {
      setToolRoot(null);
      return;
    }
    setToolRoot(tr);
    const settings = await readWorkspaceSettings(root);
    const mp = settings.modelPath?.trim();
    if (mp && (await toolRootExists(tr, mp))) return;
    const scanned = await scanModelsForGGUF(tr);
    if (!scanned) return;
    const next = { ...settings, modelPath: scanned };
    await writeWorkspaceSettings(root, next).catch(() => {});
    setModelPath(scanned);
    setLocalSettings((prev) => ({ ...prev, ggufPath: resolveModelPath(tr, scanned) }));
  }, []);

  useEffect(() => {
    if (provider !== "local" || !workspacePath) return;
    runLocalModelAutoScan();
  }, [provider, workspacePath, runLocalModelAutoScan]);

  // Auto-start llama runtime when workspace is open and we have a model (non-blocking).
  // Active GGUF = roles-first (coder) then localSettings.ggufPath; only start if path exists.
  useEffect(() => {
    const activeGgufPath =
      (modelRoles?.coder ?? localSettings.ggufPath ?? "").trim();
    if (
      provider !== "local" ||
      !workspacePath ||
      !activeGgufPath
    )
      return;
    let cancelled = false;
    console.log("[App] autoStart local runtime: toolRoot=", toolRoot ?? "(null, will use global)", "gguf=", activeGgufPath, "provider=", provider, "port=", port);
    pathExists(activeGgufPath)
      .then((exists) => {
        if (cancelled) return;
        if (!exists) {
          setGgufPathMissing(activeGgufPath);
          console.warn("[App] auto-start skipped: GGUF file not found:", activeGgufPath);
          return;
        }
        setGgufPathMissing(null);
        ensureLocalRuntime(
          { ...localSettings, ggufPath: activeGgufPath },
          toolRoot,
          port
        )
          .then((usedPort) => {
            if (!cancelled) setRuntimePort(usedPort);
          })
          .catch((e) => {
            if (!cancelled) console.warn("[App] auto-start runtime:", e);
          });
      })
      .catch(() => {
        if (!cancelled) setGgufPathMissing(activeGgufPath);
      });
    return () => {
      cancelled = true;
    };
  }, [provider, workspacePath, toolRoot, port, localSettings, modelRoles]);

  useEffect(() => {
    if (provider !== "local" || !workspacePath) return;
    const poll = () => {
      runtimeStatus().then((s) => {
        if (s.running && s.port != null) setRuntimePort(s.port);
        else setRuntimePort(null);
      }).catch(() => setRuntimePort(null));
    };
    poll();
    const t = setInterval(poll, 5000);
    return () => clearInterval(t);
  }, [provider, workspacePath]);

  const pickGGUFFile = useCallback(async () => {
    const selected = await open({
      directory: false,
      multiple: false,
      title: "Select GGUF model file",
      filters: [{ name: "GGUF model", extensions: ["gguf"] }],
    });
    if (typeof selected === "string") {
      setLocalSettings((prev) => ({ ...prev, ggufPath: selected }));
    }
  }, []);

  const onModelRolesChange = useCallback(
    async (roles: ModelRolePaths) => {
      setModelRoles(roles);
      const root = workspace.root;
      if (root) {
        const settings = await readWorkspaceSettings(root).catch(() => ({} as WorkspaceSettings));
        await writeWorkspaceSettings(root, { ...settings, modelRoles: roles }).catch(() => {});
      }
      const ggufPath = roles.coder ?? roles.general ?? "";
      if (ggufPath) {
        setLocalSettings((prev) => ({ ...prev, ggufPath }));
      }
    },
    []
  );

  const rescanModels = useCallback(async () => {
    const root = workspace.root;
    if (!root || !toolRoot) return;
    const scanned = await scanModelsForGGUF(toolRoot);
    if (!scanned) return;
    const settings = await readWorkspaceSettings(root);
    const next = { ...settings, modelPath: scanned, modelRoles: settings.modelRoles };
    await writeWorkspaceSettings(root, next).catch(() => {});
    setModelPath(scanned);
    setLocalSettings((prev) => ({ ...prev, ggufPath: resolveModelPath(toolRoot, scanned) }));
  }, [toolRoot]);

  return {
    localSettingsRef,
    toolRootRef,
    portRef,
    runtimePortRef,
    pickGGUFFile,
    rescanModels,
    onModelRolesChange,
  };
}
