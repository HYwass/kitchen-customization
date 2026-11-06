#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const MANIFEST_PATH = path.join(PROJECT_ROOT, "generation", "generation_manifest.json");
const APPLIANCE_CATALOG_PATH = path.join(PROJECT_ROOT, "catalog", "appliances.json");
const BASELINE_CATEGORIES = ["sink", "faucet", "cooktop", "extractor_hood", "oven"];

function usage(message) {
  if (message) console.error(message);
  console.error(
    "Usage: node scripts/evaluate_kitchen_functionality.mjs <final_scene.json> " +
      "[--validation <validation.json>] [--output <functionality_evaluation.json>]",
  );
  process.exit(1);
}

function parseArgs(argv) {
  if (argv.length === 0) usage();
  const options = {
    scene: path.resolve(argv[0]),
    validation: null,
    output: null,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument !== "--validation" && argument !== "--output") {
      usage(`Unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value) usage(`Missing value for ${argument}`);
    options[argument.slice(2)] = path.resolve(value);
    index += 1;
  }
  if (!fs.existsSync(options.scene)) usage(`Scene not found: ${options.scene}`);
  options.output ??= path.join(path.dirname(options.scene), "functionality_evaluation.json");
  return options;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, value));
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

function distance(left, right) {
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
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
  const applianceDocument = readJson(APPLIANCE_CATALOG_PATH);
  return {
    cabinets: rowsToMap(manifest.cabinets, manifest.cabinetColumns, "id"),
    appliances: rowsToMap(manifest.appliances, manifest.applianceColumns, "id"),
    standalone: rowsToMap(manifest.standalone, manifest.standaloneColumns, "assetId"),
    applianceDetails: new Map(
      (applianceDocument.appliances ?? []).map((appliance) => [appliance.id, appliance]),
    ),
  };
}

function findValidation(scenePath, explicitPath) {
  if (explicitPath) return fs.existsSync(explicitPath) ? explicitPath : null;
  const sceneDirectory = path.dirname(scenePath);
  const summaryPath = path.join(sceneDirectory, "run_summary.json");
  if (fs.existsSync(summaryPath)) {
    const summary = readJson(summaryPath);
    const relative = summary.validation_report ?? summary.validation;
    if (relative) {
      const candidate = path.resolve(sceneDirectory, relative);
      if (fs.existsSync(candidate)) return candidate;
    }
    if (summary.selected_iteration) {
      const candidate = path.join(sceneDirectory, summary.selected_iteration, "validation.json");
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  const direct = path.join(sceneDirectory, "validation.json");
  if (fs.existsSync(direct)) return direct;
  return null;
}

function scoreLabel(score) {
  if (score === null) return { status: "unknown", label: "未评价" };
  if (score >= 85) return { status: "excellent", label: "优秀" };
  if (score >= 70) return { status: "good", label: "良好" };
  if (score >= 55) return { status: "fair", label: "一般" };
  return { status: "needs_improvement", label: "需改进" };
}

function makeDimension(id, label, score, summary, metrics, evidence = []) {
  const roundedScore = score === null ? null : round(clamp(score), 1);
  return {
    id,
    label,
    score: roundedScore,
    ...scoreLabel(roundedScore),
    summary,
    metrics,
    evidence,
  };
}

function minimumCategoryDistance(pointsByCategory, leftCategory, rightCategory) {
  const left = pointsByCategory.get(leftCategory) ?? [];
  const right = pointsByCategory.get(rightCategory) ?? [];
  if (left.length === 0 || right.length === 0) return null;
  return Math.min(...left.flatMap((a) => right.map((b) => distance(a, b))));
}

function workTriangle(pointsByCategory) {
  const sink = pointsByCategory.get("sink")?.[0];
  const cooktop = pointsByCategory.get("cooktop")?.[0];
  const fridge = pointsByCategory.get("fridge")?.[0];
  if (!sink || !cooktop || !fridge) return null;
  const sides = {
    sinkToCooktop: distance(sink, cooktop),
    cooktopToFridge: distance(cooktop, fridge),
    fridgeToSink: distance(fridge, sink),
  };
  return { ...Object.fromEntries(Object.entries(sides).map(([key, value]) => [key, round(value)])), total: round(Object.values(sides).reduce((sum, value) => sum + value, 0)) };
}

function distanceDesirability(value, idealMinimum, idealMaximum, outerMinimum, outerMaximum) {
  if (value >= idealMinimum && value <= idealMaximum) return 100;
  if (value < idealMinimum) return clamp(((value - outerMinimum) / (idealMinimum - outerMinimum)) * 100);
  return clamp(((outerMaximum - value) / (outerMaximum - idealMaximum)) * 100);
}

function collectSceneFacts(scene, catalog) {
  const roomArea = polygonArea(scene.room?.outline ?? []);
  const worktopArea = (scene.worktop?.regions ?? []).reduce(
    (sum, region) => sum + polygonArea(region.outline ?? []),
    0,
  );
  let cutoutArea = 0;
  let floorFootprint = 0;
  let estimatedStorageVolume = 0;
  const pointsByCategory = new Map();
  const cabinetGroups = new Set();

  function addCategory(category, point) {
    if (!category) return;
    const points = pointsByCategory.get(category) ?? [];
    points.push(point);
    pointsByCategory.set(category, points);
  }

  for (const object of scene.objects ?? []) {
    const point = [Number(object.position?.[0] ?? 0), Number(object.position?.[1] ?? 0)];
    if (object.cabinetAssetId) {
      const cabinet = catalog.cabinets.get(object.cabinetAssetId);
      if (!cabinet) continue;
      cabinetGroups.add(cabinet.group);
      const volume = cabinet.width * cabinet.depth * cabinet.height;
      const storageFactor = (cabinet.slots?.length ?? 0) > 0 ? 0.35 : 0.75;
      const cornerFactor = object.cabinetAssetId.includes("CORNER") ? 0.55 : 1;
      estimatedStorageVolume += volume * storageFactor * cornerFactor;
      if (cabinet.group === "base" || cabinet.group === "tall") {
        floorFootprint += cabinet.width * cabinet.depth;
      }
      for (const applianceId of object.applianceAssetIds ?? []) {
        const category = catalog.appliances.get(applianceId)?.category;
        addCategory(category, point);
        if (category === "sink" || category === "cooktop") {
          const details = catalog.applianceDetails.get(applianceId) ?? {};
          const cutout = details.required_cutout ?? details.worktop_cutout?.size;
          if (Array.isArray(cutout) && cutout.length >= 2) cutoutArea += cutout[0] * cutout[1];
        }
      }
      continue;
    }

    const standalone = catalog.standalone.get(object.assetId);
    if (!standalone) continue;
    if (standalone.mount === "floor") floorFootprint += standalone.width * standalone.depth;
    if (standalone.assetKind === "appliance") {
      addCategory(standalone.category, point);
    }
  }

  const effectiveWorktopArea = Math.max(0, worktopArea - cutoutArea);
  return {
    roomArea,
    worktopArea,
    cutoutArea,
    effectiveWorktopArea,
    estimatedWorktopLength: effectiveWorktopArea / 0.635,
    floorFootprint,
    freeFloorRatio: roomArea > 0 ? Math.max(0, 1 - floorFootprint / roomArea) : 0,
    estimatedStorageVolume,
    storageDensity: roomArea > 0 ? estimatedStorageVolume / roomArea : 0,
    pointsByCategory,
    cabinetGroups: [...cabinetGroups].sort(),
  };
}

function evaluate(scene, validation, catalog) {
  const facts = collectSceneFacts(scene, catalog);
  const hardErrors = validation?.hardErrors ?? [];
  const hardValid = validation?.hardValid;
  const openingConflicts = hardErrors.filter((error) => /blocks (door|window)/i.test(String(error)));
  const overlapConflicts = hardErrors.filter((error) => /overlaps/i.test(String(error)));
  const boundaryConflicts = hardErrors.filter((error) => /boundary|room vertical bounds/i.test(String(error)));

  const legalityScore = hardValid === undefined
    ? null
    : hardValid ? 100 : clamp(60 - hardErrors.length * 10 - openingConflicts.length * 15);
  const legality = makeDimension(
    "legality",
    "方案合法性",
    legalityScore,
    hardValid === undefined
      ? "缺少布局核验报告，无法确认越界、碰撞和门窗冲突。"
      : hardValid ? "方案通过几何和目录硬约束。" : `检测到 ${hardErrors.length} 个硬错误。`,
    {
      hardValid: hardValid ?? null,
      hardErrorCount: hardErrors.length,
      openingConflictCount: openingConflicts.length,
      overlapConflictCount: overlapConflicts.length,
      boundaryConflictCount: boundaryConflicts.length,
    },
    hardErrors.slice(0, 10),
  );

  const presentBaseline = BASELINE_CATEGORIES.filter((category) => facts.pointsByCategory.has(category));
  const missingBaseline = BASELINE_CATEGORIES.filter((category) => !facts.pointsByCategory.has(category));
  const optionalPresent = ["fridge", "dishwasher"].filter((category) => facts.pointsByCategory.has(category));
  const basicScore = (presentBaseline.length / BASELINE_CATEGORIES.length) * 100;
  const basic = makeDimension(
    "basic_functionality",
    "基础功能",
    basicScore,
    missingBaseline.length === 0
      ? `五项基础烹饪功能齐全${optionalPresent.length ? `，并包含${optionalPresent.join("、")}` : ""}。`
      : `缺少基础功能：${missingBaseline.join("、")}。`,
    {
      baselinePresent: presentBaseline,
      baselineMissing: missingBaseline,
      optionalPresent,
      completeness: round(presentBaseline.length / BASELINE_CATEGORIES.length),
    },
  );

  const sinkCooktopDistance = minimumCategoryDistance(facts.pointsByCategory, "sink", "cooktop");
  const hoodCooktopDistance = minimumCategoryDistance(facts.pointsByCategory, "extractor_hood", "cooktop");
  const dishwasherSinkDistance = minimumCategoryDistance(facts.pointsByCategory, "dishwasher", "sink");
  const triangle = workTriangle(facts.pointsByCategory);
  const workflowParts = [];
  if (sinkCooktopDistance !== null) workflowParts.push(distanceDesirability(sinkCooktopDistance, 1.2, 2.7, 0.4, 4.5));
  else workflowParts.push(0);
  if (hoodCooktopDistance !== null) workflowParts.push(distanceDesirability(hoodCooktopDistance, 0, 0.4, 0, 1.2));
  else workflowParts.push(0);
  if (dishwasherSinkDistance !== null) workflowParts.push(distanceDesirability(dishwasherSinkDistance, 0, 1.2, 0, 2.4));
  if (triangle) {
    const sideScores = [triangle.sinkToCooktop, triangle.cooktopToFridge, triangle.fridgeToSink]
      .map((value) => distanceDesirability(value, 1.2, 2.7, 0.4, 4.5));
    const totalScore = distanceDesirability(triangle.total, 4, 7.9, 2, 11);
    workflowParts.push((sideScores.reduce((sum, value) => sum + value, 0) / 3 + totalScore) / 2);
  }
  const workflowScore = workflowParts.reduce((sum, value) => sum + value, 0) / workflowParts.length;
  const workflowEvidence = [];
  if (sinkCooktopDistance !== null && sinkCooktopDistance < 0.8) workflowEvidence.push("水槽与灶台中心距离偏小，备餐缓冲区可能不足。");
  if (hoodCooktopDistance !== null && hoodCooktopDistance > 0.4) workflowEvidence.push("油烟机与灶台的水平位置可能没有充分对齐。");
  if (dishwasherSinkDistance !== null && dishwasherSinkDistance > 1.2) workflowEvidence.push("洗碗机距离水槽较远，给排水和使用动线不理想。");
  const workflow = makeDimension(
    "workflow",
    "操作动线",
    workflowScore,
    workflowScore >= 70 ? "主要工作中心的距离和关联较合理。" : "部分工作中心的距离或对应关系需要调整。",
    {
      sinkToCooktop: sinkCooktopDistance === null ? null : round(sinkCooktopDistance),
      hoodToCooktop: hoodCooktopDistance === null ? null : round(hoodCooktopDistance),
      dishwasherToSink: dishwasherSinkDistance === null ? null : round(dishwasherSinkDistance),
      workTriangle: triangle,
    },
    workflowEvidence,
  );

  const workspaceScore = clamp((facts.effectiveWorktopArea / 1.2) * 100);
  const workspace = makeDimension(
    "workspace",
    "工作台空间",
    workspaceScore,
    `估算有效工作台面积 ${round(facts.effectiveWorktopArea, 2)} m²，约合 ${round(facts.estimatedWorktopLength, 2)} m 标准深度台面。`,
    {
      totalArea: round(facts.worktopArea),
      applianceCutoutArea: round(facts.cutoutArea),
      effectiveArea: round(facts.effectiveWorktopArea),
      estimatedStandardDepthLength: round(facts.estimatedWorktopLength),
    },
  );

  const storageScore = clamp((facts.storageDensity / 0.2) * 100);
  const storage = makeDimension(
    "storage",
    "储物能力",
    storageScore,
    `估算可用储物体积 ${round(facts.estimatedStorageVolume, 2)} m³。`,
    {
      estimatedVolume: round(facts.estimatedStorageVolume),
      volumePerRoomArea: round(facts.storageDensity),
      cabinetGroups: facts.cabinetGroups,
    },
    ["该数值由柜体外形和用途折算，用于方案比较，不等同于实际净容量。"],
  );

  const compactnessScore = validation?.metrics?.compactnessScore;
  const wallUtilization = validation?.metrics?.floor?.wallUtilization;
  const utilizationScore = Number.isFinite(compactnessScore)
    ? compactnessScore
    : Number.isFinite(wallUtilization) ? wallUtilization * 100 : null;
  const utilization = makeDimension(
    "space_utilization",
    "空间利用",
    utilizationScore,
    utilizationScore === null
      ? "缺少核验指标，无法评价柜体连续性和墙面利用率。"
      : `紧凑度 ${round(compactnessScore ?? utilizationScore, 1)}，地柜墙面利用率${Number.isFinite(wallUtilization) ? ` ${round(wallUtilization * 100, 1)}%` : "未知"}。`,
    {
      compactnessScore: compactnessScore ?? null,
      floorWallUtilization: Number.isFinite(wallUtilization) ? round(wallUtilization) : null,
      largestInternalGap: validation?.metrics?.floor?.largestInternalGap ?? null,
    },
  );

  const spaciousnessScore = clamp(((facts.freeFloorRatio - 0.55) / 0.3) * 100);
  const spaciousness = makeDimension(
    "spaciousness",
    "宽敞程度",
    spaciousnessScore,
    `落地物件约占房间地面 ${round((1 - facts.freeFloorRatio) * 100, 1)}%，自由地面比例约 ${round(facts.freeFloorRatio * 100, 1)}%。`,
    {
      roomArea: round(facts.roomArea),
      floorObjectFootprint: round(facts.floorFootprint),
      freeFloorRatio: round(facts.freeFloorRatio),
    },
    ["自由地面比例用于方案比较，不能替代最小通道宽度和人体工学测量。"],
  );

  const dimensions = [legality, basic, workflow, workspace, storage, utilization, spaciousness];
  const weights = {
    legality: 0.2,
    basic_functionality: 0.2,
    workflow: 0.2,
    workspace: 0.15,
    storage: 0.1,
    space_utilization: 0.1,
    spaciousness: 0.05,
  };
  const scored = dimensions.filter((dimension) => dimension.score !== null);
  const availableWeight = scored.reduce((sum, dimension) => sum + weights[dimension.id], 0);
  const overallScore = legality.score !== null && availableWeight > 0
    ? scored.reduce((sum, dimension) => sum + dimension.score * weights[dimension.id], 0) / availableWeight
    : null;

  const strengths = dimensions
    .filter((dimension) => dimension.score !== null && dimension.score >= 80)
    .map((dimension) => `${dimension.label}：${dimension.summary}`);
  const concerns = dimensions
    .filter((dimension) => dimension.score === null || dimension.score < 60)
    .map((dimension) => `${dimension.label}：${dimension.summary}`);
  const recommendations = [];
  if (missingBaseline.length) recommendations.push(`补充基础设备：${missingBaseline.join("、")}。`);
  if (sinkCooktopDistance !== null && sinkCooktopDistance < 0.8) recommendations.push("在水槽和灶台之间增加备餐台面或调整二者位置。");
  if (hoodCooktopDistance !== null && hoodCooktopDistance > 0.4) recommendations.push("将油烟机中心与灶台中心对齐。");
  if (dishwasherSinkDistance !== null && dishwasherSinkDistance > 1.2) recommendations.push("将洗碗机移动到水槽附近。");
  if (facts.effectiveWorktopArea < 0.8) recommendations.push("减少台面切割或重新分配柜体，以增加连续有效工作台。");
  if (Number.isFinite(wallUtilization) && wallUtilization < 0.85) recommendations.push("优化标准柜宽组合，减少柜体排布的端部余量和内部空隙。");
  if (facts.freeFloorRatio < 0.7) recommendations.push("减少非必要落地家具或调整布局，以扩大通行和活动空间。");
  if (hardValid === undefined) recommendations.push("先运行布局核验器，再确认方案合法性、碰撞和门窗净空。");

  return {
    overallScore: overallScore === null ? null : round(overallScore, 1),
    ...scoreLabel(overallScore),
    dimensions,
    strengths,
    concerns,
    recommendations: [...new Set(recommendations)],
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const scene = readJson(options.scene);
  const validationPath = findValidation(options.scene, options.validation);
  const validation = validationPath ? readJson(validationPath) : null;
  const result = evaluate(scene, validation, loadCatalog());
  const report = {
    evaluatorVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    scene: path.relative(path.dirname(options.output), options.scene).replaceAll("\\", "/"),
    validation: validationPath
      ? path.relative(path.dirname(options.output), validationPath).replaceAll("\\", "/")
      : null,
    ...result,
    assumptions: [
      "本报告用于概念方案比较，不构成施工、安全或法规合规证明。",
      "储物、工作台和宽敞度由结构化场景及目录尺寸估算。",
      "操作动线使用水槽、灶台、冰箱、油烟机和洗碗机中心点距离进行启发式评价。"
    ]
  };

  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Functionality score: ${report.overallScore ?? "unknown"} (${report.label})`);
  console.log(`Report: ${options.output}`);
}

main();
