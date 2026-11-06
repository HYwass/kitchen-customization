#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_PROFILES = path.join(PROJECT_ROOT, "generation", "multi_plan_profiles.json");
const MANIFEST_PATH = path.join(PROJECT_ROOT, "generation", "generation_manifest.json");
const BASELINE_APPLIANCES = ["sink", "faucet", "cooktop", "extractor_hood", "oven"];
const EXTENDED_APPLIANCES = [...BASELINE_APPLIANCES, "fridge", "dishwasher"];

function usage(message) {
  if (message) console.error(message);
  console.error(
    "Usage: node scripts/compare_kitchen_plans.mjs <multi-run-directory> " +
      "[--output <comparison.json>] [--profiles <multi_plan_profiles.json>]",
  );
  process.exit(1);
}

function parseArgs(argv) {
  if (argv.length === 0) usage();
  const options = {
    runDirectory: path.resolve(argv[0]),
    output: null,
    profiles: DEFAULT_PROFILES,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--output" || argument === "--profiles") {
      const value = argv[index + 1];
      if (!value) usage(`Missing value for ${argument}`);
      options[argument.slice(2)] = path.resolve(value);
      index += 1;
    } else {
      usage(`Unknown argument: ${argument}`);
    }
  }
  options.output ??= path.join(options.runDirectory, "comparison.json");
  return options;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function polygonArea(points = []) {
  if (points.length < 3) return 0;
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = (index + 1) % points.length;
    twiceArea += points[index][0] * points[next][1] - points[next][0] * points[index][1];
  }
  return Math.abs(twiceArea) / 2;
}

function structuralSignature(scene) {
  const normalized = {
    worktop: (scene.worktop?.regions ?? []).map((region) =>
      (region.outline ?? []).map(([x, y]) => [round(x, 3), round(y, 3)]),
    ),
    objects: (scene.objects ?? [])
      .map((object) => ({
        assetId: object.cabinetAssetId ?? object.assetId,
        appliances: [...(object.applianceAssetIds ?? [])].sort(),
        position: (object.position ?? []).map((value) => round(value, 3)),
        rotationZ: round(object.rotationZ ?? 0, 4),
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  };
  return crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex").slice(0, 16);
}

function setDistance(leftValues, rightValues) {
  const left = new Set(leftValues);
  const right = new Set(rightValues);
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 0;
  let intersection = 0;
  for (const value of left) {
    if (right.has(value)) intersection += 1;
  }
  return 1 - intersection / union.size;
}

function relativeDifference(left, right) {
  const scale = Math.max(Math.abs(left), Math.abs(right), 0.001);
  return Math.min(1, Math.abs(left - right) / scale);
}

function rowsToMap(rows, columns, keyColumn) {
  const keyIndex = columns.indexOf(keyColumn);
  return new Map(
    rows.map((row) => [
      row[keyIndex],
      Object.fromEntries(columns.map((column, index) => [column, row[index]])),
    ]),
  );
}

function loadCatalog() {
  const manifest = readJson(MANIFEST_PATH);
  return {
    cabinets: rowsToMap(manifest.cabinets, manifest.cabinetColumns, "id"),
    appliances: rowsToMap(manifest.appliances, manifest.applianceColumns, "id"),
    standalone: rowsToMap(manifest.standalone, manifest.standaloneColumns, "assetId"),
  };
}

function discoverPlans(runDirectory) {
  const plansDirectory = path.join(runDirectory, "plans");
  if (!fs.existsSync(plansDirectory)) {
    usage(`Missing plans directory: ${plansDirectory}`);
  }
  return fs
    .readdirSync(plansDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const directory = path.join(plansDirectory, entry.name);
      return {
        id: entry.name,
        directory,
        scenePath: path.join(directory, "final_scene.json"),
      };
    })
    .filter((plan) => fs.existsSync(plan.scenePath))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function findValidation(planDirectory) {
  const summaryPath = path.join(planDirectory, "run_summary.json");
  if (fs.existsSync(summaryPath)) {
    const summary = readJson(summaryPath);
    const relative = summary.validation_report ?? summary.validation;
    if (relative) {
      const candidate = path.resolve(planDirectory, relative);
      if (fs.existsSync(candidate)) return candidate;
    }
    if (summary.selected_iteration) {
      const candidate = path.join(planDirectory, summary.selected_iteration, "validation.json");
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  const iterations = fs
    .readdirSync(planDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^iteration_\d+$/.test(entry.name))
    .map((entry) => path.join(planDirectory, entry.name, "validation.json"))
    .filter((candidate) => fs.existsSync(candidate))
    .sort();
  return iterations.at(-1) ?? null;
}

function resolveProfileId(plan, profiles) {
  const profilePath = path.join(plan.directory, "plan_profile.json");
  if (fs.existsSync(profilePath)) {
    const declared = readJson(profilePath).profileId;
    if (profiles.some((profile) => profile.id === declared)) return declared;
  }
  return profiles.find((profile) => plan.id.includes(profile.id))?.id ?? null;
}

function measurePlan(plan, catalog, profiles) {
  const scene = readJson(plan.scenePath);
  const validationPath = findValidation(plan.directory);
  const validation = validationPath ? readJson(validationPath) : {};
  const functionalityPath = path.join(plan.directory, "functionality_evaluation.json");
  const functionality = fs.existsSync(functionalityPath) ? readJson(functionalityPath) : null;
  const roomArea = polygonArea(scene.room?.outline ?? []);
  const worktopArea = (scene.worktop?.regions ?? []).reduce(
    (total, region) => total + polygonArea(region.outline ?? []),
    0,
  );

  let floorFootprint = 0;
  let estimatedStorageVolume = 0;
  const applianceCategories = new Set();
  const cabinetGroups = new Set();
  const placementTokens = [];
  const assetTokens = [];
  let cabinetCount = 0;
  let standaloneCount = 0;

  for (const object of scene.objects ?? []) {
    if (object.cabinetAssetId) {
      const cabinet = catalog.cabinets.get(object.cabinetAssetId);
      if (!cabinet) continue;
      cabinetCount += 1;
      cabinetGroups.add(cabinet.group);
      const position = object.position ?? [0, 0, 0];
      const rotationQuarter = Math.round((object.rotationZ ?? 0) / (Math.PI / 2));
      placementTokens.push(
        `${cabinet.group}:${round(cabinet.width, 2)}x${round(cabinet.depth, 2)}x${round(cabinet.height, 2)}` +
        `@${round(position[0], 1)},${round(position[1], 1)},${round(position[2], 1)}:r${rotationQuarter}`,
      );
      assetTokens.push(object.cabinetAssetId);
      const volume = cabinet.width * cabinet.depth * cabinet.height;
      const applianceFactor = (cabinet.slots?.length ?? 0) > 0 ? 0.35 : 0.75;
      const cornerFactor = object.cabinetAssetId.includes("CORNER") ? 0.55 : 1;
      estimatedStorageVolume += volume * applianceFactor * cornerFactor;
      if (cabinet.group === "base" || cabinet.group === "tall") {
        floorFootprint += cabinet.width * cabinet.depth;
      }
      for (const applianceId of object.applianceAssetIds ?? []) {
        const category = catalog.appliances.get(applianceId)?.category;
        if (category) applianceCategories.add(category);
      }
      continue;
    }

    const standalone = catalog.standalone.get(object.assetId);
    if (!standalone) continue;
    standaloneCount += 1;
    const position = object.position ?? [0, 0, 0];
    const rotationQuarter = Math.round((object.rotationZ ?? 0) / (Math.PI / 2));
    placementTokens.push(
      `${standalone.assetKind}:${standalone.category ?? object.assetId}` +
      `@${round(position[0], 1)},${round(position[1], 1)},${round(position[2], 1)}:r${rotationQuarter}`,
    );
    assetTokens.push(object.assetId);
    if (standalone.mount === "floor") {
      floorFootprint += standalone.width * standalone.depth;
    }
    if (standalone.assetKind === "appliance") {
      applianceCategories.add(standalone.category);
    }
  }

  const baselinePresent = BASELINE_APPLIANCES.filter((item) => applianceCategories.has(item));
  const extendedPresent = EXTENDED_APPLIANCES.filter((item) => applianceCategories.has(item));
  const hardValid = validation.hardValid === true;
  const metrics = validation.metrics ?? {};
  const compactness = Number.isFinite(metrics.compactnessScore)
    ? metrics.compactnessScore / 100
    : 0;
  const floorWallUtilization = Number.isFinite(metrics.floor?.wallUtilization)
    ? metrics.floor.wallUtilization
    : null;

  return {
    id: plan.id,
    profileId: resolveProfileId(plan, profiles),
    structuralSignature: structuralSignature(scene),
    diversityFeatures: {
      placementTokens: placementTokens.sort(),
      assetTokens: assetTokens.sort(),
    },
    scene: path.relative(plan.directory, plan.scenePath).replaceAll("\\", "/"),
    validation: validationPath
      ? path.relative(plan.directory, validationPath).replaceAll("\\", "/")
      : null,
    functionalityEvaluation: functionality
      ? path.relative(plan.directory, functionalityPath).replaceAll("\\", "/")
      : null,
    functionalityScore: functionality?.overallScore ?? null,
    functionalityLabel: functionality?.label ?? null,
    functionalityDimensions: Object.fromEntries(
      (functionality?.dimensions ?? []).map((dimension) => [dimension.id, dimension.score]),
    ),
    hardValid,
    targetsMet: validation.targetsMet === true,
    rawMetrics: {
      roomArea: round(roomArea),
      cabinetCount,
      standaloneCount,
      cabinetGroups: [...cabinetGroups].sort(),
      applianceCategories: [...applianceCategories].sort(),
      baselineAppliancesPresent: baselinePresent,
      functionalCompleteness: round(baselinePresent.length / BASELINE_APPLIANCES.length),
      functionalVariety: round(extendedPresent.length / EXTENDED_APPLIANCES.length),
      estimatedStorageVolume: round(estimatedStorageVolume),
      worktopArea: round(worktopArea),
      floorFootprint: round(floorFootprint),
      spaciousness: round(roomArea > 0 ? Math.max(0, 1 - floorFootprint / roomArea) : 0),
      compactness: round(compactness),
      compactnessScore: metrics.compactnessScore ?? null,
      floorWallUtilization,
    },
  };
}

function compareDiversity(plans, minimumScore = 0.22, minimumSignals = 2) {
  const pairs = [];
  for (let leftIndex = 0; leftIndex < plans.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < plans.length; rightIndex += 1) {
      const left = plans[leftIndex];
      const right = plans[rightIndex];
      const placementDifference = setDistance(
        left.diversityFeatures.placementTokens,
        right.diversityFeatures.placementTokens,
      );
      const assetDifference = setDistance(
        left.diversityFeatures.assetTokens,
        right.diversityFeatures.assetTokens,
      );
      const applianceDifference = setDistance(
        left.rawMetrics.applianceCategories,
        right.rawMetrics.applianceCategories,
      );
      const cabinetGroupDifference = setDistance(
        left.rawMetrics.cabinetGroups,
        right.rawMetrics.cabinetGroups,
      );
      const worktopAreaDifference = relativeDifference(
        left.rawMetrics.worktopArea,
        right.rawMetrics.worktopArea,
      );
      const floorFootprintDifference = relativeDifference(
        left.rawMetrics.floorFootprint,
        right.rawMetrics.floorFootprint,
      );
      const cabinetCountDifference = Math.abs(
        left.rawMetrics.cabinetCount - right.rawMetrics.cabinetCount,
      );
      const score = round(
        placementDifference * 0.5 +
        assetDifference * 0.2 +
        applianceDifference * 0.08 +
        cabinetGroupDifference * 0.04 +
        worktopAreaDifference * 0.1 +
        floorFootprintDifference * 0.08,
        3,
      );
      const signals = [
        placementDifference >= 0.2 ? "placement" : null,
        assetDifference >= 0.25 ? "cabinet_or_asset_selection" : null,
        applianceDifference > 0 ? "appliance_set" : null,
        cabinetGroupDifference > 0 ? "cabinet_groups" : null,
        worktopAreaDifference >= 0.1 ? "worktop_area" : null,
        floorFootprintDifference >= 0.1 ? "floor_footprint" : null,
        cabinetCountDifference >= 2 ? "cabinet_count" : null,
      ].filter(Boolean);
      pairs.push({
        planIds: [left.id, right.id],
        visibleDifferenceScore: score,
        requiredScore: minimumScore,
        differenceSignals: signals,
        requiredSignalCount: minimumSignals,
        passed: score >= minimumScore && signals.length >= minimumSignals,
        metrics: {
          placementDifference: round(placementDifference, 3),
          assetDifference: round(assetDifference, 3),
          applianceDifference: round(applianceDifference, 3),
          worktopAreaDifference: round(worktopAreaDifference, 3),
          floorFootprintDifference: round(floorFootprintDifference, 3),
          cabinetCountDifference,
        },
      });
    }
  }
  return pairs;
}

function minMax(plans, key) {
  const values = plans.map((plan) => plan.rawMetrics[key]);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  if (Math.abs(maximum - minimum) < 1e-9) {
    return new Map(plans.map((plan) => [plan.id, 0.5]));
  }
  return new Map(
    plans.map((plan) => [plan.id, (plan.rawMetrics[key] - minimum) / (maximum - minimum)]),
  );
}

function evaluate(plans, profiles) {
  const storageScores = minMax(plans, "estimatedStorageVolume");
  const worktopScores = minMax(plans, "worktopArea");
  const normalized = new Map(
    plans.map((plan) => [
      plan.id,
      {
        hardValidity: plan.hardValid ? 1 : 0,
        functionalCompleteness: plan.rawMetrics.functionalCompleteness,
        functionalVariety: plan.rawMetrics.functionalVariety,
        estimatedStorageVolume: storageScores.get(plan.id),
        worktopArea: worktopScores.get(plan.id),
        compactness: plan.rawMetrics.compactness,
        spaciousness: plan.rawMetrics.spaciousness,
      },
    ]),
  );

  const rankings = {};
  for (const profile of profiles) {
    const rows = plans.map((plan) => {
      const planMetrics = normalized.get(plan.id);
      const score = Object.entries(profile.comparisonWeights).reduce(
        (total, [metric, weight]) => total + (planMetrics[metric] ?? 0) * weight,
        0,
      );
      return { planId: plan.id, hardValid: plan.hardValid, score: round(score * 100, 2) };
    });
    rows.sort((left, right) => Number(right.hardValid) - Number(left.hardValid) || right.score - left.score);
    rankings[profile.id] = rows.map((row, index) => ({ rank: index + 1, ...row }));
  }
  return { normalized, rankings };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const profileDocument = readJson(options.profiles);
  const profiles = profileDocument.profiles ?? [];
  const minimumDiversityScore = profileDocument.rules?.minimumPairwiseVisibleDifference ?? 0.22;
  const minimumDiversitySignals = profileDocument.rules?.minimumPairwiseDifferenceSignals ?? 2;
  const discovered = discoverPlans(options.runDirectory);
  if (discovered.length < 2) {
    usage(`At least two completed plans are required; found ${discovered.length}.`);
  }

  const catalog = loadCatalog();
  const plans = discovered.map((plan) => measurePlan(plan, catalog, profiles));
  const { normalized, rankings } = evaluate(plans, profiles);
  const signatureGroups = new Map();
  for (const plan of plans) {
    const group = signatureGroups.get(plan.structuralSignature) ?? [];
    group.push(plan);
    signatureGroups.set(plan.structuralSignature, group);
  }
  const duplicateLayoutGroups = [...signatureGroups.entries()]
    .map(([signature, group]) => ({ signature, planIds: group.map((plan) => plan.id) }))
    .filter((group) => group.planIds.length > 1);
  const pairwiseDiversity = compareDiversity(
    plans,
    minimumDiversityScore,
    minimumDiversitySignals,
  );
  const insufficientlyDifferentPairs = pairwiseDiversity.filter((pair) => !pair.passed);
  const diversityWarnings = insufficientlyDifferentPairs.map(
    (pair) => `Plans are too similar: ${pair.planIds.join(" vs ")} ` +
      `(visible difference ${pair.visibleDifferenceScore}, signals ${pair.differenceSignals.length}).`,
  );
  const report = {
    comparisonVersion: "1.1.0",
    generatedAt: new Date().toISOString(),
    runDirectory: path.relative(PROJECT_ROOT, options.runDirectory).replaceAll("\\", "/"),
    planCount: plans.length,
    metricNotes: {
      estimatedStorageVolume: "Approximation from external cabinet volume; appliance cabinets and corners use reduction factors.",
      spaciousness: "One minus catalog floor-object footprint divided by room floor area; it is a comparison indicator, not a clearance guarantee.",
      hardValidity: "Plans with validator hard errors rank below hard-valid plans regardless of preference score.",
    },
    plans: plans.map((plan) => ({
      ...plan,
      normalizedMetrics: Object.fromEntries(
        Object.entries(normalized.get(plan.id)).map(([key, value]) => [key, round(value)]),
      ),
    })),
    rankings,
    duplicateLayoutGroups,
    diversityPassed: insufficientlyDifferentPairs.length === 0,
    pairwiseDiversity,
    insufficientlyDifferentPairs,
    warnings: [
      ...duplicateLayoutGroups.map(
        (group) => `Structurally identical final plans: ${group.planIds.join(", ")}`,
      ),
      ...diversityWarnings,
    ],
    bestByGoal: Object.fromEntries(
      profiles.map((profile) => [
        profile.id,
        {
          label: profile.label,
          planId: rankings[profile.id]?.[0]?.planId ?? null,
          score: rankings[profile.id]?.[0]?.score ?? null,
        },
      ]),
    ),
  };

  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Compared ${plans.length} plans.`);
  console.log(`Report: ${options.output}`);
}

main();
