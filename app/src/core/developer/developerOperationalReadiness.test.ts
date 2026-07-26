import { assertDeveloperCommandApproval, createDeveloperSessionState } from "./developerState";
import type {
  DeveloperWorkspaceInfo,
  FrictionEntry,
  ProviderDiagnostics,
  ProviderSettings,
} from "./developerServices";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const profile: DeveloperWorkspaceInfo = {
  canonicalPath: "D:\\work\\sample",
  repositoryName: "sample",
  branch: "main",
  head: "0123456789abcdef",
  dirty: false,
  status: "## main\n",
  diff: "",
  profile: {
    projectType: "Flutter",
    projectName: "sample",
    flutterSdkAvailable: true,
    dartSdkAvailable: true,
    suggestedCommands: [
      { label: "Get dependencies", command: "flutter pub get", permitted: true },
      { label: "Analyze", command: "flutter analyze", permitted: true },
      { label: "Run tests", command: "flutter test", permitted: true },
      { label: "Check formatting", command: "dart format --output=none --set-exit-if-changed lib", permitted: true },
    ],
  },
};

assert(profile.profile.projectType === "Flutter", "Flutter profile must be represented");
assert(JSON.stringify(profile.profile.suggestedCommands.map((item) => item.command)) === JSON.stringify([
  "flutter pub get",
  "flutter analyze",
  "flutter test",
  "dart format --output=none --set-exit-if-changed lib",
]), "curated frontend commands must remain exact");
let blocked = false;
try {
  assertDeveloperCommandApproval(false, "flutter analyze");
} catch {
  blocked = true;
}
assert(blocked, "command execution without approval must be blocked");
assertDeveloperCommandApproval(true, "flutter analyze");

const friction: FrictionEntry = {
  id: "one",
  timestamp: new Date(0).toISOString(),
  repositoryCanonicalPath: profile.canonicalPath,
  repositoryName: profile.repositoryName,
  branch: profile.branch,
  area: "Commands",
  description: "A metadata-only operational observation.",
  severity: "Minor",
  status: "Open",
};
assert(friction.status === "Open", "friction status must remain typed");

const fakeSecret = "fake-test-secret";
const providerSettings: ProviderSettings = {
  provider: "openai",
  openaiModel: "test-model",
  localModelPath: "",
};
const diagnostics: ProviderDiagnostics = {
  provider: "openai",
  state: "available",
  model: "test-model",
  configured: true,
  credentialAvailable: true,
  localModelAvailable: false,
  real: true,
  message: "Shared saved backend credential is available.",
};
for (const persistedOrReturned of [
  providerSettings,
  diagnostics,
  createDeveloperSessionState(),
  friction,
]) {
  assert(!JSON.stringify(persistedOrReturned).includes(fakeSecret), "frontend JSON must never contain credentials");
  assert(!Object.keys(persistedOrReturned).some((key) => /api.?key|authorization/i.test(key)), "frontend shapes must not expose secret fields");
}

console.log("Developer operational-readiness frontend tests passed.");
