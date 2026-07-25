import type {
  CurrentProductInventory,
  GapAnalysis,
  GapAnalysisItem,
  IntakeConfidenceLevel,
  PreservationRules,
  ProductBrief,
  ProjectBlueprint,
} from "../types";

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function keyFrom(value: string): string {
  return normalize(value).replace(/\s+/g, "-") || "item";
}

function inventoryText(inventory: CurrentProductInventory | null): string {
  if (!inventory) return "";
  return [
    ...inventory.filesInspected,
    ...inventory.packageFiles,
    ...inventory.sourceFolders,
    ...inventory.importantFiles.map((file) => `${file.path} ${file.reason}`),
    ...inventory.uiEntryPoints,
    ...inventory.routesOrNavigationHints,
    ...inventory.componentsWidgetsScreens,
    ...Object.values(inventory.detectedCommands).filter(Boolean),
  ]
    .map(normalize)
    .join(" ");
}

function featureLikelyExists(feature: string, haystack: string): boolean {
  const normalizedFeature = normalize(feature);
  if (!normalizedFeature) return false;
  const tokens = expandTokens(normalizedFeature.split(/\s+/g).filter((token) => token.length > 2));
  if (haystack.includes(normalizedFeature)) return true;
  return tokens.length > 0 && tokens.every((token) => haystack.includes(token));
}

function featureLikelyPartial(feature: string, haystack: string): boolean {
  const tokens = expandTokens(normalize(feature).split(/\s+/g).filter((token) => token.length > 2));
  if (tokens.length < 2) return false;
  return tokens.some((token) => haystack.includes(token));
}

function expandTokens(tokens: string[]): string[] {
  return Array.from(new Set(tokens.flatMap((token) => {
    if (token.endsWith("ies") && token.length > 4) {
      return [token, `${token.slice(0, -3)}y`];
    }
    if (token.endsWith("s") && token.length > 3) {
      return [token, token.slice(0, -1)];
    }
    return [token];
  })));
}

function relatedFilesForFeature(feature: string, inventory: CurrentProductInventory | null): string[] {
  if (!inventory) return [];
  const normalizedFeature = normalize(feature);
  const featureTokens = normalizedFeature.split(/\s+/g).filter((token) => token.length > 2);
  const candidates = [
    ...inventory.uiEntryPoints,
    ...inventory.routesOrNavigationHints,
    ...inventory.componentsWidgetsScreens,
    ...inventory.importantFiles.map((file) => file.path),
  ];

  return candidates.filter((path) => {
    const normalizedPath = normalize(path);
    return featureTokens.some((token) => normalizedPath.includes(token));
  });
}

function item(label: string, reason: string, relatedFiles: string[] = []): GapAnalysisItem {
  return {
    key: keyFrom(label),
    label,
    reason,
    relatedFiles,
  };
}

function getProductBrief(blueprint: ProjectBlueprint): ProductBrief | null {
  return blueprint.productBrief.data;
}

function analyzeFeatures(
  productBrief: ProductBrief | null,
  inventory: CurrentProductInventory | null
): Pick<GapAnalysis, "existingItems" | "missingMvpFeatures" | "partialFeatures"> {
  const features = productBrief?.mvpFeatures ?? [];
  const haystack = inventoryText(inventory);
  const existingItems: GapAnalysisItem[] = [];
  const missingMvpFeatures: GapAnalysisItem[] = [];
  const partialFeatures: GapAnalysisItem[] = [];

  for (const feature of features) {
    const relatedFiles = relatedFilesForFeature(feature, inventory);
    if (featureLikelyExists(feature, haystack)) {
      existingItems.push(item(feature, "This MVP feature appears to exist in the current product inventory.", relatedFiles));
    } else if (featureLikelyPartial(feature, haystack)) {
      partialFeatures.push(item(feature, "Some related files or naming hints exist, but the feature is not clearly complete.", relatedFiles));
    } else {
      missingMvpFeatures.push(item(feature, "This MVP feature was requested in the Product Brief but was not found in inventory.", relatedFiles));
    }
  }

  return { existingItems, missingMvpFeatures, partialFeatures };
}

function analyzeBlockers(blueprint: ProjectBlueprint, inventory: CurrentProductInventory | null): GapAnalysisItem[] {
  const blockers: GapAnalysisItem[] = [];
  const blockingDecisions = blueprint.founderDecisions.data.filter((decision) => decision.status === "pending");
  if (blockingDecisions.length > 0) {
    blockers.push(
      item(
        "Pending founder decisions",
        `There are ${blockingDecisions.length} founder decision(s) that may affect planning or implementation.`
      )
    );
  }

  if (blueprint.identity.source === "existingProject" && (!inventory || inventory.filesInspected.length === 0)) {
    blockers.push(item("No current product inventory", "NF has no imported product inventory to compare against."));
  }

  if (blueprint.identity.source === "existingProject" && inventory && !inventory.detectedCommands.build && !inventory.detectedCommands.test) {
    blockers.push(
      item(
        "Build/test commands not detected",
        "NF could not identify build or test commands, so later quality gates may need command confirmation."
      )
    );
  }

  return blockers;
}

function analyzePreservationWarnings(
  missingMvpFeatures: GapAnalysisItem[],
  partialFeatures: GapAnalysisItem[],
  inventory: CurrentProductInventory | null,
  preservationRules: PreservationRules | null
): GapAnalysisItem[] {
  if (!preservationRules || !inventory) return [];
  const touchesExistingUi =
    inventory.uiEntryPoints.length > 0 ||
    inventory.routesOrNavigationHints.length > 0 ||
    inventory.componentsWidgetsScreens.length > 0;
  if (!touchesExistingUi) return [];
  const workItems = [...missingMvpFeatures, ...partialFeatures];

  return workItems.map((gap) =>
    item(
      gap.label,
      "This work may touch existing UI, routes, screens, widgets, or workflows. Preserve current behavior and extend rather than rewrite unless the founder approves a larger change.",
      [
        ...inventory.uiEntryPoints,
        ...inventory.routesOrNavigationHints,
        ...inventory.componentsWidgetsScreens.slice(0, 5),
      ]
    )
  );
}

function chooseNextFocus(
  missingMvpFeatures: GapAnalysisItem[],
  partialFeatures: GapAnalysisItem[],
  possibleBlockers: GapAnalysisItem[]
): string {
  if (partialFeatures.length > 0) {
    return `Complete partial feature: ${partialFeatures[0].label}`;
  }
  if (missingMvpFeatures.length > 0) {
    return `Build missing MVP feature: ${missingMvpFeatures[0].label}`;
  }
  if (possibleBlockers.length > 0) {
    return `Resolve blocker: ${possibleBlockers[0].label}`;
  }
  return "No MVP feature gaps detected. Confirm quality gates and prepare the next phase.";
}

function confidenceFor(blueprint: ProjectBlueprint, inventory: CurrentProductInventory | null): IntakeConfidenceLevel {
  if (blueprint.productBrief.data && inventory && inventory.filesInspected.length > 0) return "high";
  if (blueprint.productBrief.data) return "medium";
  return "low";
}

export function createGapAnalysis(blueprint: ProjectBlueprint, now = new Date().toISOString()): GapAnalysis {
  const inventory = blueprint.currentProductInventory.data;
  const preservationRules = blueprint.preservationRules.data;
  const productBrief = getProductBrief(blueprint);
  const { existingItems, missingMvpFeatures, partialFeatures } = analyzeFeatures(productBrief, inventory);
  const possibleBlockers = analyzeBlockers(blueprint, inventory);
  const preservationWarnings = analyzePreservationWarnings(
    missingMvpFeatures,
    partialFeatures,
    inventory,
    preservationRules
  );

  return {
    blueprintId: blueprint.id,
    analyzedAt: now,
    existingItems,
    missingMvpFeatures,
    partialFeatures,
    possibleBlockers,
    preservationWarnings,
    recommendedNextBuildFocus: chooseNextFocus(missingMvpFeatures, partialFeatures, possibleBlockers),
    confidenceLevel: confidenceFor(blueprint, inventory),
  };
}
