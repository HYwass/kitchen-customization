import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";

import {
  APPLIANCE_ASSETS,
  CABINET_ASSETS,
  CATALOG_META,
  FRONT_ASSETS,
  FURNITURE_ASSETS,
  HANDLE_ASSETS,
  WORKTOP_ASSETS,
  defaultFrontForCabinet,
} from "./catalog.js";
import { cloneDemoScene } from "./demo-scene.js";
import { automatedViewDirection } from "./render-view.js";
import { exportKitchenDrawings } from "./drawing-export.js";
import "./styles.css";

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

const renderParameters = new URLSearchParams(window.location.search);
const generatedRunId = renderParameters.get("run");
const generatedPlanId = renderParameters.get("plan");
const reconstructionId = renderParameters.get("reconstruction");
const standaloneConversationStorageKey = "kitchen-editor-ai-conversation";
const storedStandaloneConversationKey = readSessionStorage(standaloneConversationStorageKey);
let editorConversationKey = generatedRunId && generatedPlanId
  ? `run:${generatedRunId}:plan:${generatedPlanId}`
  : reconstructionId
    ? `reconstruction:${reconstructionId}`
    : storedStandaloneConversationKey;
if (!editorConversationKey) {
  editorConversationKey = `standalone:${createLocalId()}`;
  writeSessionStorage(standaloneConversationStorageKey, editorConversationKey);
}
const automatedRenderView = renderParameters.get("render") === "1"
  ? renderParameters.get("view")
  : null;
const automatedSceneUrl = renderParameters.get("scene");
if (automatedRenderView) {
  document.body.classList.add("render-mode");
  window.__KITCHEN_RENDER_STATUS__ = "loading";
  window.__KITCHEN_RENDER_VIEW__ = automatedRenderView;
  window.addEventListener("error", (event) => {
    window.__KITCHEN_RENDER_STATUS__ = "error";
    window.__KITCHEN_RENDER_ERROR__ = event.error?.message ?? event.message;
  });
  window.addEventListener("unhandledrejection", (event) => {
    window.__KITCHEN_RENDER_STATUS__ = "error";
    window.__KITCHEN_RENDER_ERROR__ = event.reason?.message ?? String(event.reason);
  });
}

const dom = {
  workspace: document.querySelector(".workspace"),
  viewport: document.querySelector("#viewport"),
  assetLibrary: document.querySelector("#asset-library"),
  sceneTree: document.querySelector("#scene-tree"),
  sceneName: document.querySelector("#scene-name"),
  objectCount: document.querySelector("#object-count"),
  worktopStyle: document.querySelector("#worktop-style-select"),
  inspectorTitle: document.querySelector("#inspector-title"),
  inspectorSubtitle: document.querySelector("#inspector-subtitle"),
  inspectorContent: document.querySelector("#inspector-content"),
  loadingOverlay: document.querySelector("#loading-overlay"),
  loadingText: document.querySelector("#loading-text"),
  toast: document.querySelector("#toast"),
  resetButton: document.querySelector("#reset-button"),
  loadButton: document.querySelector("#load-button"),
  loadInput: document.querySelector("#load-input"),
  saveButton: document.querySelector("#save-button"),
  drawingButton: document.querySelector("#drawing-button"),
  selectTool: document.querySelector("#select-tool"),
  moveTool: document.querySelector("#move-tool"),
  rotateTool: document.querySelector("#rotate-tool"),
  openTool: document.querySelector("#open-tool"),
  focusTool: document.querySelector("#focus-tool"),
  deleteTool: document.querySelector("#delete-tool"),
  toggleLeftPanel: document.querySelector("#toggle-left-panel"),
  toggleRightPanel: document.querySelector("#toggle-right-panel"),
  aiStatusDot: document.querySelector("#ai-status-dot"),
  aiConversation: document.querySelector("#ai-conversation"),
  aiRefineForm: document.querySelector("#ai-refine-form"),
  aiRefineInput: document.querySelector("#ai-refine-input"),
  aiRefineSubmit: document.querySelector("#ai-refine-submit"),
  aiPreviewActions: document.querySelector("#ai-preview-actions"),
  aiDiscardButton: document.querySelector("#ai-discard-button"),
  aiAcceptButton: document.querySelector("#ai-accept-button"),
};

let sceneState = cloneDemoScene();
let selectedId = null;
let activeTool = "select";
let selectionBox = null;
let loadingCount = 0;
let toastTimer = null;
let pointerDownState = null;
let previousFrameTime = null;
let worktopRebuildQueued = false;
let lastCollisionToastTime = 0;
let refinementOriginalState = null;
let refinementEventSource = null;

const COLLISION_EPSILON = 0.0001;
const COLLISION_PATH_STEP = 0.02;
const COLLISION_ROTATION_STEP = THREE.MathUtils.degToRad(2);
const ASSET_LOAD_TIMEOUT_MS = 20000;
const OPENING_DEFAULTS = {
  doorSideClearance: 0.05,
  doorPassageDepth: 0.6,
  windowClearanceDepth: 0.15,
  windowVerticalClearance: 0.05,
};
const OPENING_VISUAL_ASSETS = {
  door: { path: "/openings/DOOR_STANDARD.glb", width: 0.9, height: 2.1 },
  window: { path: "/openings/WINDOW_STANDARD.glb", width: 1.2, height: 1.1 },
};

if (automatedSceneUrl) {
  try {
    const response = await fetch(automatedSceneUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`无法读取场景 JSON：HTTP ${response.status}`);
    const parsed = migrateLegacyBuiltInFronts(migrateLegacyWorktop(await response.json()));
    validateSceneState(parsed);
    sceneState = parsed;
  } catch (error) {
    window.__KITCHEN_RENDER_STATUS__ = "error";
    window.__KITCHEN_RENDER_ERROR__ = error.message;
    throw error;
  }
}

const CABINET_LIBRARY_GROUPS = [
  { id: "base", label: "BASE" },
  { id: "wall", label: "WALL" },
  { id: "tall", label: "TALL" },
];

const objectMap = new Map();
const rebuildTokens = new Map();
const assetTemplatePromises = new Map();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf2f1ed);
scene.fog = new THREE.Fog(0xf2f1ed, 7, 14);

const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 50);
camera.position.set(3.9, 4.5, 3.2);
const topCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
let activeCamera = camera;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
dom.viewport.appendChild(renderer.domElement);

const orbitControls = new OrbitControls(camera, renderer.domElement);
orbitControls.enableDamping = true;
orbitControls.dampingFactor = 0.08;
orbitControls.target.set(1.2, 0.35, 0.9);
orbitControls.minDistance = 1.2;
orbitControls.maxDistance = 10;
orbitControls.maxPolarAngle = Math.PI * 0.49;
orbitControls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
orbitControls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
orbitControls.mouseButtons.RIGHT = null;

const transformControls = new TransformControls(camera, renderer.domElement);
transformControls.setTranslationSnap(0.05);
transformControls.setRotationSnap(THREE.MathUtils.degToRad(90));
transformControls.setSpace("world");
const transformHelper = transformControls.getHelper();
scene.add(transformHelper);

const sceneRoot = new THREE.Group();
sceneRoot.name = "kitchen_scene";
scene.add(sceneRoot);

const roomRoot = new THREE.Group();
roomRoot.name = "room_environment";
scene.add(roomRoot);

const worktopRoot = new THREE.Group();
worktopRoot.name = "worktop_root";
scene.add(worktopRoot);

const finishRoot = new THREE.Group();
finishRoot.name = "procedural_finishes";
scene.add(finishRoot);

const FINISH_DEFAULTS = {
  plinthFrontRecess: 0.08,
  panelThickness: 0.018,
  fillerMaxWidth: 0.25,
  backsplashHeight: 0.5,
  backsplashThickness: 0.012,
  worktopEdgeThickness: 0.008,
};

const gltfLoader = new GLTFLoader();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

setupStaticUi();
setupEvents();
checkRefinementService();
resizeRenderer();
try {
  await setupEnvironment();
  await rebuildEntireScene();
  if (automatedRenderView) {
    configureAutomatedRenderView(automatedRenderView);
    dom.loadingOverlay.classList.add("hidden");
    renderer.render(scene, activeCamera);
    window.__KITCHEN_RENDER_STATUS__ = "ready";
  } else {
    renderer.setAnimationLoop(renderLoop);
  }
} catch (error) {
  loadingCount = 0;
  updateLoadingOverlay();
  console.error("编辑器初始化失败", error);
  if (automatedRenderView) {
    window.__KITCHEN_RENDER_STATUS__ = "error";
    window.__KITCHEN_RENDER_ERROR__ = error.message;
  } else {
    renderer.setAnimationLoop(renderLoop);
    showToast(`编辑器初始化失败：${error.message}`, true);
  }
}

function readSessionStorage(key) {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSessionStorage(key, value) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // The editor can still work when browser storage is unavailable.
  }
}

function createLocalId() {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

async function setupEnvironment() {
  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x8d8b85, 2.0);
  scene.add(hemisphere);

  const keyLight = new THREE.DirectionalLight(0xffffff, 3.1);
  keyLight.position.set(2.5, 3.5, 5.5);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.left = -4;
  keyLight.shadow.camera.right = 4;
  keyLight.shadow.camera.top = 4;
  keyLight.shadow.camera.bottom = -4;
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xffead7, 1.2);
  fillLight.position.set(-3, 1, 2.5);
  scene.add(fillLight);

  await rebuildRoomEnvironment();
}

async function rebuildRoomEnvironment() {
  disposeObjectChildren(roomRoot);
  roomRoot.clear();

  const roomConfig = sceneState.room;
  const roomHeight = roomConfig.height;
  const wallThickness = roomConfig.wallThickness;
  const floorElevation = roomConfig.floorElevation;
  const roomOutline = roomConfig.outline.map(([x, y]) => new THREE.Vector2(x, y));
  const bounds = new THREE.Box2().setFromPoints(roomOutline);
  const roomCenter = bounds.getCenter(new THREE.Vector2());
  const roomSize = bounds.getSize(new THREE.Vector2());

  const floorTexture = createFloorTexture();
  floorTexture.repeat.set(Math.max(roomSize.x / 1.2, 1), Math.max(roomSize.y / 1.2, 1));
  const floorMaterial = new THREE.MeshStandardMaterial({
    color: 0xe0d8cc,
    map: floorTexture,
    roughness: 0.82,
    metalness: 0,
  });
  const floorPoints = [...roomOutline];
  if (THREE.ShapeUtils.isClockWise(floorPoints)) floorPoints.reverse();
  const floorShape = new THREE.Shape(floorPoints);
  const floor = new THREE.Mesh(new THREE.ShapeGeometry(floorShape), floorMaterial);
  floor.position.z = floorElevation;
  floor.receiveShadow = true;
  floor.name = "floor";
  roomRoot.add(floor);

  const wallTexture = createWallTexture();
  wallTexture.repeat.set(Math.max(roomSize.x / 2, 1), Math.max(roomHeight / 2, 1));
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: 0xf2efe8,
    map: wallTexture,
    roughness: 0.9,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  for (let index = 0; index < roomOutline.length; index += 1) {
    const start = roomOutline[index];
    const end = roomOutline[(index + 1) % roomOutline.length];
    const edge = end.clone().sub(start);
    const length = edge.length();
    const outwardNormal = new THREE.Vector2(edge.y, -edge.x).normalize();
    const center = start.clone().add(end).multiplyScalar(0.5)
      .addScaledVector(outwardNormal, wallThickness / 2);
    addRoomWall(
      `wall_${String(index + 1).padStart(2, "0")}`,
      [length, wallThickness, roomHeight],
      [center.x, center.y, floorElevation + roomHeight / 2],
      Math.atan2(edge.y, edge.x),
      wallMaterial,
      roomRoot,
    );
  }

  await addRoomOpenings(roomConfig);

  const gridSize = Math.max(roomSize.x, roomSize.y);
  const gridDivisions = Math.max(10, Math.ceil(gridSize / 0.1));
  const grid = new THREE.GridHelper(gridSize, gridDivisions, 0xa9a59c, 0xcecbc4);
  grid.name = "floor_grid";
  grid.rotation.x = Math.PI / 2;
  grid.position.set(roomCenter.x, roomCenter.y, floorElevation + 0.002);
  grid.material.opacity = 0.28;
  grid.material.transparent = true;
  roomRoot.add(grid);

  const viewDistance = Math.max(gridSize * 1.25, roomHeight * 1.6, 3);
  orbitControls.target.set(roomCenter.x, roomCenter.y, floorElevation + roomHeight * 0.35);
  orbitControls.maxDistance = Math.max(10, viewDistance * 2.2);
  camera.position.set(
    roomCenter.x + viewDistance * 0.75,
    roomCenter.y + viewDistance * 0.85,
    floorElevation + viewDistance * 0.65,
  );
  orbitControls.update();
}

function resolveRoomOpening(room, opening) {
  const startValue = room.outline[opening.wallIndex];
  const endValue = room.outline[(opening.wallIndex + 1) % room.outline.length];
  if (!startValue || !endValue) return null;
  const start = new THREE.Vector2(...startValue);
  const end = new THREE.Vector2(...endValue);
  const edge = end.clone().sub(start);
  const wallLength = edge.length();
  if (wallLength <= 1e-7) return null;
  const direction = edge.clone().divideScalar(wallLength);
  const inward = new THREE.Vector2(-direction.y, direction.x);
  const center = start.clone().addScaledVector(direction, opening.centerOffset);
  return {
    opening,
    start,
    end,
    wallLength,
    direction,
    inward,
    center,
    rotationZ: Math.atan2(direction.y, direction.x),
    minZ: room.floorElevation + opening.bottomOffset,
    maxZ: room.floorElevation + opening.bottomOffset + opening.height,
  };
}

function openingCollisionEnvelope(room, opening) {
  const geometry = resolveRoomOpening(room, opening);
  if (!geometry) return null;
  const isInwardSwing = opening.type === "door"
    && opening.operation === "swing"
    && opening.opensToward === "inward";
  const depth = opening.type === "window"
    ? OPENING_DEFAULTS.windowClearanceDepth
    : isInwardSwing ? opening.width : OPENING_DEFAULTS.doorPassageDepth;
  const sideClearance = opening.type === "door" ? OPENING_DEFAULTS.doorSideClearance : 0.01;
  const center = geometry.center.clone().addScaledVector(geometry.inward, depth / 2);
  return {
    opening,
    centerX: center.x,
    centerY: center.y,
    minZ: opening.type === "window"
      ? Math.max(room.floorElevation, geometry.minZ - OPENING_DEFAULTS.windowVerticalClearance)
      : geometry.minZ,
    maxZ: geometry.maxZ,
    axisX: { x: geometry.direction.x, y: geometry.direction.y },
    axisY: { x: geometry.inward.x, y: geometry.inward.y },
    halfWidth: opening.width / 2 + sideClearance,
    halfDepth: depth / 2,
  };
}

async function addRoomOpenings(room) {
  const clearanceMaterial = new THREE.MeshBasicMaterial({
    color: 0xe6a45a,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
  });

  for (const opening of room.openings) {
    const geometry = resolveRoomOpening(room, opening);
    if (!geometry) continue;
    const asset = OPENING_VISUAL_ASSETS[opening.type];
    const model = await loadAsset(asset.path);
    const modelCenter = geometry.center.clone().addScaledVector(geometry.inward, 0.002);
    model.name = `opening_${opening.id}_${opening.type}_model`;
    model.position.set(modelCenter.x, modelCenter.y, geometry.minZ);
    model.rotation.z = geometry.rotationZ;
    model.scale.set(opening.width / asset.width, 1, opening.height / asset.height);
    roomRoot.add(model);

    if (opening.operation === "swing" && opening.opensToward === "inward") {
      addDoorSwingGuide(geometry, clearanceMaterial);
    }
  }
}

function addDoorSwingGuide(geometry, clearanceMaterial) {
  const { opening, direction, inward, center, minZ } = geometry;
  const hingeSign = opening.hingeSide === "end" ? 1 : -1;
  const hinge = center.clone().addScaledVector(direction, hingeSign * opening.width / 2);
  const clearanceCenter = center.clone().addScaledVector(inward, opening.width / 2);
  addWorldBox(
    roomRoot,
    `opening_${opening.id}_swing_clearance`,
    [opening.width, opening.width, 0.006],
    [clearanceCenter.x, clearanceCenter.y, minZ + 0.004],
    geometry.rotationZ,
    clearanceMaterial,
  );

  const closedDirection = direction.clone().multiplyScalar(opening.hingeSide === "end" ? -1 : 1);
  const startAngle = Math.atan2(closedDirection.y, closedDirection.x);
  const sweep = opening.hingeSide === "end" ? -Math.PI / 2 : Math.PI / 2;
  const points = Array.from({ length: 25 }, (_, index) => {
    const angle = startAngle + sweep * index / 24;
    return new THREE.Vector3(
      hinge.x + Math.cos(angle) * opening.width,
      hinge.y + Math.sin(angle) * opening.width,
      minZ + 0.012,
    );
  });
  const arc = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: 0xc77935, transparent: true, opacity: 0.85 }),
  );
  arc.name = `opening_${opening.id}_swing_arc`;
  roomRoot.add(arc);
  const openEnd = hinge.clone().addScaledVector(inward, opening.width);
  const leaf = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(hinge.x, hinge.y, minZ + 0.013),
      new THREE.Vector3(openEnd.x, openEnd.y, minZ + 0.013),
    ]),
    new THREE.LineBasicMaterial({ color: 0xc77935, transparent: true, opacity: 0.9 }),
  );
  leaf.name = `opening_${opening.id}_open_leaf`;
  roomRoot.add(leaf);
}

function createFloorTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  context.fillStyle = "#ddd4c7";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "rgba(105, 88, 68, 0.18)";
  context.lineWidth = 2;
  for (let y = 0; y <= canvas.height; y += 64) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(canvas.width, y);
    context.stroke();
  }
  for (let row = 0; row < 8; row += 1) {
    const offset = row % 2 === 0 ? 0 : 128;
    for (let x = offset; x <= canvas.width; x += 256) {
      context.beginPath();
      context.moveTo(x, row * 64);
      context.lineTo(x, (row + 1) * 64);
      context.stroke();
    }
  }
  context.strokeStyle = "rgba(255, 255, 255, 0.16)";
  context.lineWidth = 1;
  for (let y = 18; y < canvas.height; y += 64) {
    context.beginPath();
    context.moveTo(0, y);
    context.bezierCurveTo(150, y - 5, 350, y + 6, 512, y - 2);
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

function createWallTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  context.fillStyle = "#f3f0e9";
  context.fillRect(0, 0, 256, 256);
  for (let index = 0; index < 220; index += 1) {
    const x = (index * 73) % 256;
    const y = (index * 151) % 256;
    const alpha = 0.025 + ((index * 17) % 10) / 500;
    context.fillStyle = `rgba(110, 104, 94, ${alpha})`;
    context.fillRect(x, y, 1, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

function addRoomWall(name, size, position, rotationZ, material, parent) {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  wall.position.set(...position);
  wall.rotation.z = rotationZ;
  wall.receiveShadow = true;
  wall.name = name;
  parent.add(wall);

  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(wall.geometry),
    new THREE.LineBasicMaterial({ color: 0xaaa69d, transparent: true, opacity: 0.45 }),
  );
  outline.position.copy(wall.position);
  outline.rotation.copy(wall.rotation);
  outline.name = `${name}_outline`;
  parent.add(outline);
}

function cabinetLibraryGroupId(asset) {
  if (asset.family === "base") return "base";
  if (asset.family === "wall") return "wall";
  return "tall";
}

function cabinetLibrarySubtype(asset) {
  const groupId = cabinetLibraryGroupId(asset);
  const groupName = groupId === "base" ? "Base" : groupId === "wall" ? "Wall" : "Tall";
  if (asset.cornerGeometry?.type === "blind") {
    const side = asset.cornerGeometry.accessible_side === "left" ? "left opening" : "right opening";
    return `${groupName} corner · blind (${side})`;
  }
  if (asset.cornerGeometry?.type === "diagonal" && !(asset.applianceSlots?.length)) {
    return `${groupName} corner · diagonal`;
  }
  const applianceNames = (asset.applianceSlots ?? []).map((slot) => {
    const category = compatibleAppliances(slot.interfaceId)[0]?.category;
    const labels = {
      oven: "Oven",
      sink: "Sink",
      cooktop: "Cooktop",
      faucet: "Faucet",
      fridge: "Fridge",
      extractor_hood: "Extractor Hood",
      dishwasher: "Dishwasher",
    };
    return labels[category] ?? slot.interfaceId;
  });
  if (applianceNames.length) {
    const corner = asset.cornerGeometry ? " corner" : "";
    return `${groupName}${corner} built-in with ${applianceNames.join(" + ")}`;
  }
  if (asset.family === "top") {
    return asset.id.includes("FRIDGE") ? "Above-fridge top cabinet" : "Top cabinet";
  }
  return `${groupName} cabinet`;
}

function cabinetCardHtml(asset) {
  const groupId = cabinetLibraryGroupId(asset);
  const icon = groupId === "wall" ? "▱" : groupId === "tall" ? "▥" : "▰";
  return `
    <button class="asset-card" type="button" data-add-asset="${asset.id}">
      <span class="asset-icon ${groupId}">${icon}</span>
      <span class="asset-card-copy">
        <strong>${asset.label}</strong>
        <small>${formatDimensions(asset.dimensions)}</small>
      </span>
      <span class="asset-add">＋</span>
    </button>
  `;
}

function cabinetLibraryHtml() {
  const assets = Object.values(CABINET_ASSETS);
  return CABINET_LIBRARY_GROUPS.map((group) => {
    const groupAssets = assets.filter((asset) => cabinetLibraryGroupId(asset) === group.id);
    const subtypes = [...new Set(groupAssets.map(cabinetLibrarySubtype))];
    return `
      <section class="asset-primary-group">
        <h4>${group.label}</h4>
        ${subtypes.map((subtype) => `
          <div class="asset-subgroup">
            <h5>${subtype}</h5>
            ${groupAssets.filter((asset) => cabinetLibrarySubtype(asset) === subtype).map(cabinetCardHtml).join("")}
          </div>
        `).join("")}
      </section>
    `;
  }).join("") + standaloneLibraryHtml();
}

function standaloneLibraryHtml() {
  const standaloneAppliances = Object.values(APPLIANCE_ASSETS).filter((asset) => asset.placement);
  const groups = [
    { label: "APPLIANCES", kind: "appliance", assets: standaloneAppliances },
    { label: "TABLES", kind: "furniture", assets: Object.values(FURNITURE_ASSETS).filter((asset) => asset.category === "table") },
    { label: "CHAIRS", kind: "furniture", assets: Object.values(FURNITURE_ASSETS).filter((asset) => asset.category !== "table") },
  ];
  return groups.map(({ label, kind, assets }) => `
    <section class="asset-primary-group">
      <h4>${label}</h4>
      ${assets.map((asset) => `
        <button class="asset-card" type="button" data-add-standalone-kind="${kind}" data-add-standalone-asset="${asset.id}">
          <span class="asset-icon ${kind}">${kind === "appliance" ? "▣" : "◇"}</span>
          <span class="asset-card-copy"><strong>${asset.label}</strong><small>${formatDimensions(asset.bodySize)}</small></span>
          <span class="asset-add">＋</span>
        </button>
      `).join("")}
    </section>
  `).join("");
}

function cabinetOptionsHtml(selectedValue) {
  const assets = Object.values(CABINET_ASSETS);
  return CABINET_LIBRARY_GROUPS.map((group) => {
    const groupAssets = assets.filter((asset) => cabinetLibraryGroupId(asset) === group.id);
    const subtypes = [...new Set(groupAssets.map(cabinetLibrarySubtype))];
    return subtypes.map((subtype) => `
      <optgroup label="${group.label} / ${subtype}">
        ${groupAssets
          .filter((asset) => cabinetLibrarySubtype(asset) === subtype)
          .map((asset) => `<option value="${asset.id}" ${asset.id === selectedValue ? "selected" : ""}>${asset.label}</option>`)
          .join("")}
      </optgroup>
    `).join("");
  }).join("");
}

function setupStaticUi() {
  dom.assetLibrary.innerHTML = cabinetLibraryHtml();

  dom.worktopStyle.innerHTML = optionsHtml(WORKTOP_ASSETS, null);
  dom.worktopStyle.addEventListener("change", async (event) => {
    sceneState.worktop.assetId = event.target.value;
    await rebuildWorktop();
    await rebuildItemsWithWorktopAppliances();
    showToast("台面风格已更新");
  });
}

function setupEvents() {
  renderer.domElement.addEventListener("pointerdown", onViewportPointerDown);
  renderer.domElement.addEventListener("pointerup", onViewportPointerUp);
  renderer.domElement.addEventListener("contextmenu", (event) => event.preventDefault());
  window.addEventListener("resize", resizeRenderer);

  const resizeObserver = new ResizeObserver(resizeRenderer);
  resizeObserver.observe(dom.viewport);

  transformControls.addEventListener("dragging-changed", (event) => {
    orbitControls.enabled = !event.value;
  });
  transformControls.addEventListener("objectChange", syncSelectedTransformFromObject);

  dom.assetLibrary.addEventListener("click", async (event) => {
    const standaloneButton = event.target.closest("[data-add-standalone-asset]");
    if (standaloneButton) {
      await addStandaloneAsset(
        standaloneButton.dataset.addStandaloneKind,
        standaloneButton.dataset.addStandaloneAsset,
      );
      return;
    }
    const button = event.target.closest("[data-add-asset]");
    if (button) await addCabinet(button.dataset.addAsset);
  });
  dom.sceneTree.addEventListener("click", (event) => {
    const row = event.target.closest("[data-scene-id]");
    if (row) setSelected(row.dataset.sceneId);
  });

  dom.selectTool.addEventListener("click", () => setTool("select"));
  dom.moveTool.addEventListener("click", () => setTool("translate"));
  dom.rotateTool.addEventListener("click", () => setTool("rotate"));
  dom.openTool.addEventListener("click", toggleSelectedFront);
  dom.focusTool.addEventListener("click", focusSelected);
  dom.deleteTool.addEventListener("click", deleteSelected);
  dom.toggleLeftPanel.addEventListener("click", () => togglePanel("left"));
  dom.toggleRightPanel.addEventListener("click", () => togglePanel("right"));
  dom.resetButton.addEventListener("click", resetScene);
  dom.saveButton.addEventListener("click", saveSceneJson);
  dom.drawingButton.addEventListener("click", exportCurrentDrawings);
  dom.loadButton.addEventListener("click", () => dom.loadInput.click());
  dom.loadInput.addEventListener("change", loadSceneJson);
  dom.aiRefineForm.addEventListener("submit", submitAiRefinement);
  dom.aiDiscardButton.addEventListener("click", discardAiRefinement);
  dom.aiAcceptButton.addEventListener("click", acceptAiRefinement);
  window.addEventListener("keydown", onKeyDown);
}

function togglePanel(side) {
  const isLeft = side === "left";
  const className = isLeft ? "left-panel-hidden" : "right-panel-hidden";
  const button = isLeft ? dom.toggleLeftPanel : dom.toggleRightPanel;
  const hidden = dom.workspace.classList.toggle(className);
  button.setAttribute("aria-expanded", String(!hidden));
  button.title = hidden
    ? `显示${isLeft ? "组件栏" : "对象编辑栏"}`
    : `隐藏${isLeft ? "组件栏" : "对象编辑栏"}`;
  button.textContent = isLeft
    ? (hidden ? "组件栏 ▶" : "◀ 组件栏")
    : (hidden ? "◀ 对象栏" : "对象栏 ▶");
}

function renderLoop(time) {
  const delta = previousFrameTime === null ? 0 : Math.min((time - previousFrameTime) / 1000, 0.05);
  previousFrameTime = time;
  updateFrontAnimations(delta);
  orbitControls.update();
  if (selectionBox) selectionBox.update();
  renderer.render(scene, activeCamera);
}

function resizeRenderer() {
  const width = dom.viewport.clientWidth;
  const height = dom.viewport.clientHeight;
  if (!width || !height) return;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function configureAutomatedRenderView(view) {
  if (!["top", "perspective"].includes(view)) throw new Error(`未知自动渲染视图：${view}`);
  const width = Math.max(1, dom.viewport.clientWidth);
  const height = Math.max(1, dom.viewport.clientHeight);
  const aspect = width / height;
  const outline = sceneState.room.outline.map(([x, y]) => new THREE.Vector2(x, y));
  const bounds = new THREE.Box2().setFromPoints(outline);
  const center2 = bounds.getCenter(new THREE.Vector2());
  const size2 = bounds.getSize(new THREE.Vector2());
  const floorElevation = sceneState.room.floorElevation;
  const roomHeight = sceneState.room.height;
  roomRoot.getObjectByName("floor_grid")?.removeFromParent();
  scene.fog = null;
  // Keep room outlines for context without obscuring cabinet fronts.
  for (const object of roomRoot.children) {
    if (object.isMesh && object.name.startsWith("wall_")) object.visible = false;
  }

  if (view === "top") {
    const margin = 0.35;
    let halfWidth = Math.max(size2.x / 2 + margin, 1);
    let halfHeight = Math.max(size2.y / 2 + margin, 1);
    if (halfWidth / halfHeight < aspect) halfWidth = halfHeight * aspect;
    else halfHeight = halfWidth / aspect;
    topCamera.left = -halfWidth;
    topCamera.right = halfWidth;
    topCamera.top = halfHeight;
    topCamera.bottom = -halfHeight;
    topCamera.position.set(center2.x, center2.y, floorElevation + roomHeight + 6);
    topCamera.up.set(0, 1, 0);
    topCamera.lookAt(center2.x, center2.y, floorElevation);
    topCamera.updateProjectionMatrix();
    activeCamera = topCamera;
    return;
  }

  const target = new THREE.Vector3(center2.x, center2.y, floorElevation + roomHeight * 0.38);
  const radius = Math.max(Math.hypot(size2.x, size2.y, roomHeight) / 2, 1);
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
  const limitingFov = Math.min(verticalFov, horizontalFov);
  const distance = radius / Math.sin(limitingFov / 2) * 1.12;
  const floorRotations = sceneState.objects
    .filter((item) => !item.cabinetAssetId?.startsWith("CAB_WALL_") && !item.cabinetAssetId?.startsWith("CAB_TOP_"))
    .map((item) => item.rotationZ);
  const direction = new THREE.Vector3(...automatedViewDirection(floorRotations)).normalize();
  camera.aspect = aspect;
  camera.near = Math.max(0.01, distance - radius * 2.5);
  camera.far = distance + radius * 3.5;
  camera.position.copy(target).addScaledVector(direction, distance);
  camera.up.set(0, 0, 1);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  activeCamera = camera;
}

async function loadAsset(path) {
  if (!assetTemplatePromises.has(path)) {
    loadingCount += 1;
    updateLoadingOverlay();
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`载入超时（${ASSET_LOAD_TIMEOUT_MS / 1000} 秒）`)), ASSET_LOAD_TIMEOUT_MS);
    });
    const promise = Promise
      .race([gltfLoader.loadAsync(path), timeout])
      .then((gltf) => {
        gltf.scene.traverse((object) => {
          if (object.isMesh) {
            object.castShadow = true;
            object.receiveShadow = true;
          }
        });
        return gltf.scene;
      })
      .catch((error) => {
        assetTemplatePromises.delete(path);
        throw new Error(`无法载入模型 ${path}: ${error.message}`);
      })
      .finally(() => {
        loadingCount -= 1;
        updateLoadingOverlay();
      });
    assetTemplatePromises.set(path, promise);
  }
  const template = await assetTemplatePromises.get(path);
  const source = template.clone(true);
  source.rotation.x = Math.PI / 2;
  const axisAdapter = new THREE.Group();
  axisAdapter.name = "gltf_y_up_to_editor_z_up";
  axisAdapter.userData.axisConversion = "rotate_x_positive_90_degrees";
  axisAdapter.add(source);
  return axisAdapter;
}

function updateLoadingOverlay() {
  dom.loadingOverlay.classList.toggle("hidden", loadingCount === 0);
  dom.loadingText.textContent = loadingCount > 1 ? `正在载入 ${loadingCount} 个厨房资产…` : "正在载入厨房资产…";
}

async function createCabinetAssembly(item) {
  const cabinetAsset = CABINET_ASSETS[item.cabinetAssetId];
  if (!cabinetAsset) throw new Error(`未知柜体资产：${item.cabinetAssetId}`);

  const root = new THREE.Group();
  root.name = item.id;
  root.position.fromArray(item.position);
  root.rotation.z = item.rotationZ ?? 0;
  root.userData.itemId = item.id;
  root.userData.editableRoot = true;

  if (!cabinetAsset.construction.carrier_only) {
    const cabinetModel = await loadAsset(cabinetAsset.path);
    cabinetModel.name = "cabinet_model";
    applyCabinetConstructionVisibility(cabinetModel, cabinetAsset.construction);
    root.add(cabinetModel);
  }

  if (item.frontAssetId && FRONT_ASSETS[item.frontAssetId]) {
    item.frontOpen = Boolean(item.frontOpen);
    const frontAsset = FRONT_ASSETS[item.frontAssetId];
    if (item.handleAssetId && !isHandleCompatibleWithFront(item.handleAssetId, item.frontAssetId)) {
      item.handleAssetId = defaultHandleForFront(item.frontAssetId);
    }
    const frontMount = cabinetFrontMount(cabinetAsset);
    if (frontAsset.layoutKind === "mixed") {
      await addMixedFrontAssembly(root, item, cabinetAsset, frontAsset, frontMount);
    } else {
      const front = await loadAsset(frontAsset.path);
      front.name = "front_component";
      front.scale.set(
        frontMount.width / frontAsset.templateSize[0],
        1,
        cabinetAsset.dimensions[2] / frontAsset.templateSize[1],
      );
      front.position.set(frontMount.x, frontMount.y, 0);
      front.rotation.z = frontMount.rotationZ;
      root.add(front);
      const motionGroups = createFrontMotionGroups(root, front, frontAsset, cabinetAsset, frontMount);
      if (item.handleAssetId && HANDLE_ASSETS[item.handleAssetId]) {
        await addHandles(root, item, cabinetAsset, motionGroups, frontMount);
      }
    }
    setFrontMotionState(root, item.frontOpen ? 1 : 0, true);
  }

  for (const applianceId of item.applianceAssetIds ?? []) {
    if (!APPLIANCE_ASSETS[applianceId]) continue;
    const appliance = await loadAsset(APPLIANCE_ASSETS[applianceId].path);
    appliance.name = `appliance_${applianceId}`;
    positionAppliance(appliance, applianceId, item, cabinetAsset);
    root.add(appliance);
  }

  root.traverse((object) => {
    object.userData.itemId = item.id;
  });
  return root;
}

function standaloneAssetForItem(item) {
  if (item.assetKind === "appliance") return APPLIANCE_ASSETS[item.assetId] ?? null;
  if (item.assetKind === "furniture") return FURNITURE_ASSETS[item.assetId] ?? null;
  return null;
}

function sceneItemDimensions(item) {
  return CABINET_ASSETS[item.cabinetAssetId]?.dimensions ?? standaloneAssetForItem(item)?.bodySize ?? null;
}

async function createStandaloneAssembly(item) {
  const asset = standaloneAssetForItem(item);
  if (!asset) throw new Error(`未知独立资产：${item.assetId}`);
  const root = new THREE.Group();
  root.name = item.id;
  root.position.fromArray(item.position);
  root.rotation.z = item.rotationZ ?? 0;
  root.userData.itemId = item.id;
  root.userData.editableRoot = true;
  const model = await loadAsset(asset.path);
  model.name = `${item.assetKind}_${item.assetId}`;
  root.add(model);
  root.traverse((object) => { object.userData.itemId = item.id; });
  return root;
}

function createSceneObjectAssembly(item) {
  return item.cabinetAssetId ? createCabinetAssembly(item) : createStandaloneAssembly(item);
}

function cabinetFrontMount(cabinetAsset) {
  const [width, depth] = cabinetAsset.dimensions;
  const corner = cabinetAsset.cornerGeometry;
  if (corner?.type === "blind") {
    const openingWidth = corner.accessible_front_width;
    return {
      width: openingWidth,
      x: corner.accessible_side === "left" ? -width / 2 + openingWidth / 2 : width / 2 - openingWidth / 2,
      y: depth / 2 + 0.001,
      rotationZ: 0,
    };
  }
  if (corner?.type === "diagonal") {
    return {
      width: corner.diagonal_front_width,
      x: width / 4 + 0.001 / Math.SQRT2,
      y: depth / 4 + 0.001 / Math.SQRT2,
      rotationZ: -Math.PI / 4,
    };
  }
  return { width, x: 0, y: depth / 2 + 0.001, rotationZ: 0 };
}

function applyCabinetConstructionVisibility(model, construction) {
  const hiddenNames = new Set();
  if (construction.omit_top_panel) hiddenNames.add("carcass_top");
  if (construction.omit_bottom_panel) hiddenNames.add("carcass_bottom");
  if (construction.omit_bottom_slot_support) hiddenNames.add("slot_support_bottom");
  model.traverse((object) => {
    if (hiddenNames.has(object.name.toLowerCase())) object.visible = false;
  });
}

function mixedFrontStorageZones(cabinetAsset) {
  const cabinetHeight = cabinetAsset.dimensions[2];
  const cavities = (cabinetAsset.applianceSlots ?? [])
    .map(({ slot }) => {
      if (!slot?.local_center || !slot?.niche_size || !slot.mount_type?.includes("cavity")) return null;
      const halfHeight = slot.niche_size[2] / 2;
      return {
        min: Math.max(0, slot.local_center[2] - halfHeight),
        max: Math.min(cabinetHeight, slot.local_center[2] + halfHeight),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.min - right.min);

  const merged = [];
  for (const cavity of cavities) {
    const previous = merged.at(-1);
    if (previous && cavity.min <= previous.max) previous.max = Math.max(previous.max, cavity.max);
    else merged.push({ ...cavity });
  }

  const zones = [];
  let cursor = 0;
  for (const cavity of merged) {
    if (cavity.min - cursor >= 0.06) zones.push({ min: cursor, max: cavity.min });
    cursor = Math.max(cursor, cavity.max);
  }
  if (cabinetHeight - cursor >= 0.06) zones.push({ min: cursor, max: cabinetHeight });
  return zones;
}

async function addMixedFrontAssembly(root, item, cabinetAsset, frontAsset, frontMount) {
  const zones = mixedFrontStorageZones(cabinetAsset);
  const motionGroups = [];

  for (const [index, zone] of zones.entries()) {
    const zoneHeight = zone.max - zone.min;
    const template = zoneHeight < frontMount.width * 0.75
      ? frontAsset.mixedPanelTemplates.horizontal
      : frontAsset.mixedPanelTemplates.vertical;
    const front = await loadAsset(template.path);
    front.name = `front_component_storage_${index + 1}`;
    front.scale.set(frontMount.width / template.size[0], 1, zoneHeight / template.size[1]);
    front.position.set(frontMount.x, frontMount.y, zone.min);
    front.rotation.z = frontMount.rotationZ;
    root.add(front);
    if (zoneHeight >= 0.14) {
      motionGroups.push(...createFrontMotionGroups(root, front, frontAsset, cabinetAsset, frontMount));
    }
  }

  if (frontAsset.zones?.includes("left_filler") && frontAsset.zones.includes("right_filler")) {
    const cavity = (cabinetAsset.applianceSlots ?? [])
      .map(({ slot }) => slot)
      .find((slot) => slot?.niche_size && slot.mount_type?.includes("cavity"));
    const fillerWidth = cavity ? (frontMount.width - cavity.niche_size[0]) / 2 : 0;
    if (cavity && fillerWidth > 0.002) {
      const fillerHeight = cavity.niche_size[2];
      const centerZ = cavity.local_center[2];
      const centerOffsetX = cavity.niche_size[0] / 2 + fillerWidth / 2;
      const material = createCatalogMaterial(frontAsset.material);
      addEditorBox(
        root,
        "front_fixed_filler_left",
        [fillerWidth, 0.018, fillerHeight],
        [frontMount.x - centerOffsetX, frontMount.y + 0.009, centerZ],
        material,
      );
      addEditorBox(
        root,
        "front_fixed_filler_right",
        [fillerWidth, 0.018, fillerHeight],
        [frontMount.x + centerOffsetX, frontMount.y + 0.009, centerZ],
        material,
      );
    }
  }

  root.userData.frontMotionGroups = motionGroups;
  if (item.handleAssetId && HANDLE_ASSETS[item.handleAssetId]) {
    await addMixedFrontHandles(root, item, motionGroups, frontMount, zones);
  }
}

async function addMixedFrontHandles(root, item, motionGroups, frontMount, zones) {
  const handleAsset = HANDLE_ASSETS[item.handleAssetId];
  const rotatesWithFront = ["bar", "edge_pull"].includes(handleAsset.type);

  for (const [index, zone] of zones.entries()) {
    const zoneHeight = zone.max - zone.min;
    if (zoneHeight < 0.14) continue;
    const canFitVertically = handleVerticalExtent(handleAsset, true, rotatesWithFront) + 0.04 <= zoneHeight;
    const placement = {
      x: frontMount.width / 2 - Math.min(0.06, frontMount.width * 0.15),
      z: (zone.min + zone.max) / 2,
      vertical: zoneHeight >= 0.35 && canFitVertically,
    };
    const handle = await loadAsset(handleAsset.path);
    handle.name = `handle_storage_${index + 1}`;
    const handleOffset = new THREE.Vector2(placement.x, 0.02).rotateAround(
      new THREE.Vector2(),
      frontMount.rotationZ,
    );
    handle.position.set(frontMount.x + handleOffset.x, frontMount.y + handleOffset.y, placement.z);
    handle.rotation.z = frontMount.rotationZ;
    if (placement.vertical && rotatesWithFront) handle.rotation.y = -Math.PI / 2;
    root.add(handle);
    const owner = findNearestFrontMotionGroup(motionGroups, placement);
    if (owner) {
      root.updateMatrixWorld(true);
      owner.attach(handle);
    }
  }
}

function createFrontMotionGroups(root, front, frontAsset, cabinetAsset, frontMount) {
  const panelParts = collectFrontPanelParts(front);
  const motionGroups = [];
  const layoutId = frontAsset.layoutId;
  const isDrawer = layoutId.startsWith("DRAWERS_");
  const isHorizontalDoor = layoutId === "DOOR_HORIZONTAL";
  const isDishwasherDoor = cabinetAsset.applianceSlots?.some((slot) => slot.interfaceId === "DISHWASHER_600");
  const drawerMaterial = isDrawer ? createCatalogMaterial(frontAsset.drawerBox.material) : null;

  for (const [panelId, parts] of panelParts) {
    const box = getObjectsBoundsInSpace(parts, root);
    if (box.isEmpty()) continue;
    const center = box.getCenter(new THREE.Vector3());
    const motionGroup = new THREE.Group();
    motionGroup.name = `front_motion_${panelId}`;

    let motionType = "door";
    let openAngle = 0;
    let openDistance = 0;
    if (isDrawer) {
      motionType = "drawer";
      openDistance = Math.min(0.45, cabinetAsset.dimensions[1] * 0.7);
    } else if (isDishwasherDoor) {
      motionType = "horizontal_door";
      motionGroup.position.set(center.x, box.min.y, box.min.z);
      openAngle = THREE.MathUtils.degToRad(-90);
    } else if (isHorizontalDoor) {
      motionType = "horizontal_door";
      motionGroup.position.set(center.x, box.min.y, box.max.z);
      openAngle = THREE.MathUtils.degToRad(95);
    } else {
      const opensFromRight = panelParts.length > 1 && center.x > 0;
      const hingeX = opensFromRight ? box.max.x : box.min.x;
      motionGroup.position.set(hingeX, box.min.y, 0);
      openAngle = THREE.MathUtils.degToRad(opensFromRight ? -105 : 105);
    }

    root.add(motionGroup);
    root.updateMatrixWorld(true);
    for (const part of parts) motionGroup.attach(part);
    if (isDrawer) {
      addProceduralDrawerBox(motionGroup, box, cabinetAsset, frontAsset.drawerBox, drawerMaterial, panelId);
    }

    motionGroup.userData.frontMotion = {
      type: motionType,
      panelId,
      panelCenter: center,
      closedPosition: motionGroup.position.clone(),
      openAngle,
      openDistance,
      openDirection: new THREE.Vector2(-Math.sin(frontMount.rotationZ), Math.cos(frontMount.rotationZ)),
      currentOpen: 0,
      targetOpen: 0,
    };
    motionGroups.push(motionGroup);
  }

  root.userData.frontMotionGroups = motionGroups;
  return motionGroups;
}

function addProceduralDrawerBox(group, panelBox, cabinetAsset, config, material, panelId) {
  const panelSize = panelBox.getSize(new THREE.Vector3());
  const bodyWidth = Math.min(
    panelSize.x - config.side_clearance_each,
    cabinetAsset.dimensions[0] - 2 * config.side_clearance_each,
  );
  const bodyFrontY = panelBox.min.y - config.front_clearance;
  const bodyBackY = -cabinetAsset.dimensions[1] / 2 + config.rear_clearance;
  const bodyDepth = bodyFrontY - bodyBackY;
  const sideHeight = Math.min(
    config.maximum_side_height,
    panelSize.z - config.vertical_clearance,
  );
  if (bodyWidth <= 0 || bodyDepth <= 0 || sideHeight <= 0) return;

  const side = config.side_thickness;
  const bottom = config.bottom_thickness;
  const centerY = (bodyFrontY + bodyBackY) / 2;
  const bottomZ = panelBox.min.z + config.vertical_clearance / 2;
  const sideZ = bottomZ + sideHeight / 2;
  const prefix = `drawer_box_${panelId}`;

  addEditorBox(group, `${prefix}_bottom`, [bodyWidth - 2 * side, bodyDepth, bottom], [0, centerY, bottomZ + bottom / 2], material);
  addEditorBox(group, `${prefix}_left`, [side, bodyDepth, sideHeight], [-bodyWidth / 2 + side / 2, centerY, sideZ], material);
  addEditorBox(group, `${prefix}_right`, [side, bodyDepth, sideHeight], [bodyWidth / 2 - side / 2, centerY, sideZ], material);
  addEditorBox(group, `${prefix}_back`, [bodyWidth - 2 * side, side, sideHeight], [0, bodyBackY + side / 2, sideZ], material);
}

function addEditorBox(parent, name, size, position, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
}

function createCatalogMaterial(definition) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(definition.base_color),
    roughness: definition.roughness,
    metalness: definition.metallic,
  });
}

function collectFrontPanelParts(front) {
  const groups = new Map();
  const fallbackMeshes = [];
  front.traverse((object) => {
    if (!object.isMesh) return;
    fallbackMeshes.push(object);
    const match = object.name.match(/^(front_panel_\d+)/i);
    if (!match) return;
    const panelId = match[1].toLowerCase();
    if (!groups.has(panelId)) groups.set(panelId, []);
    groups.get(panelId).push(object);
  });

  if (groups.size > 0) {
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }));
  }
  return fallbackMeshes.length > 0 ? [["front_panel_01", fallbackMeshes]] : [];
}

function getObjectsBoundsInSpace(objects, reference) {
  reference.updateMatrixWorld(true);
  const inverseReference = reference.matrixWorld.clone().invert();
  const result = new THREE.Box3();
  const point = new THREE.Vector3();

  for (const object of objects) {
    object.updateMatrixWorld(true);
    object.geometry.computeBoundingBox();
    const source = object.geometry.boundingBox;
    const transform = inverseReference.clone().multiply(object.matrixWorld);
    for (const x of [source.min.x, source.max.x]) {
      for (const y of [source.min.y, source.max.y]) {
        for (const z of [source.min.z, source.max.z]) {
          result.expandByPoint(point.set(x, y, z).applyMatrix4(transform));
        }
      }
    }
  }
  return result;
}

function handleVerticalExtent(handleAsset, vertical, rotatesWithFront) {
  return vertical && rotatesWithFront
    ? handleAsset.dimensions[0]
    : handleAsset.dimensions[2];
}

function clampHandleCenterZ(desiredZ, frontHeight, handleAsset, vertical, rotatesWithFront) {
  const extent = handleVerticalExtent(handleAsset, vertical, rotatesWithFront);
  const preferredEdgeClearance = 0.06;
  const availableClearance = Math.max(0, (frontHeight - extent) / 2);
  const edgeClearance = Math.min(preferredEdgeClearance, availableClearance);
  const minimumZ = extent / 2 + edgeClearance;
  const maximumZ = frontHeight - extent / 2 - edgeClearance;
  if (minimumZ > maximumZ) return frontHeight / 2;
  return THREE.MathUtils.clamp(desiredZ, minimumZ, maximumZ);
}

async function addHandles(root, item, cabinetAsset, motionGroups, frontMount) {
  const handleAsset = HANDLE_ASSETS[item.handleAssetId];
  const frontAsset = FRONT_ASSETS[item.frontAssetId];
  const rotatesWithFront = ["bar", "edge_pull"].includes(handleAsset.type);
  const isVerticalDoor = frontAsset.layoutKind === "door" && frontAsset.layoutId !== "DOOR_HORIZONTAL";
  const isDishwasherDoor = cabinetAsset.applianceSlots?.some((slot) => slot.interfaceId === "DISHWASHER_600");
  const placements = [];

  if (isDishwasherDoor) {
    placements.push({ x: 0, z: 0.7, vertical: false });
  } else if (frontAsset.layoutId === "DRAWERS_3") {
    for (const z of [0.7, 0.45, 0.15]) {
      placements.push({ x: 0, z, vertical: false });
    }
  } else {
    const z = ["wall", "top"].includes(cabinetAsset.family) ? 0.12 : 0.68;
    placements.push({ x: -0.04, z, vertical: isVerticalDoor });
    placements.push({ x: 0.04, z, vertical: isVerticalDoor });
  }

  for (const [index, placement] of placements.entries()) {
    const fittedPlacement = {
      ...placement,
      z: clampHandleCenterZ(
        placement.z,
        cabinetAsset.dimensions[2],
        handleAsset,
        placement.vertical,
        rotatesWithFront,
      ),
    };
    const handle = await loadAsset(handleAsset.path);
    handle.name = `handle_${index + 1}`;
    const handleOffset = new THREE.Vector2(fittedPlacement.x, 0.02).rotateAround(
      new THREE.Vector2(),
      frontMount.rotationZ,
    );
    handle.position.set(frontMount.x + handleOffset.x, frontMount.y + handleOffset.y, fittedPlacement.z);
    handle.rotation.z = frontMount.rotationZ;
    if (fittedPlacement.vertical && rotatesWithFront) handle.rotation.y = -Math.PI / 2;
    root.add(handle);
    const owner = findNearestFrontMotionGroup(motionGroups, fittedPlacement);
    if (owner) {
      root.updateMatrixWorld(true);
      owner.attach(handle);
    }
  }
}

function findNearestFrontMotionGroup(motionGroups, placement) {
  let nearest = null;
  let nearestDistance = Infinity;
  for (const group of motionGroups) {
    const center = group.userData.frontMotion.panelCenter;
    const distance = Math.hypot(center.x - placement.x, center.z - placement.z);
    if (distance < nearestDistance) {
      nearest = group;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function setFrontMotionState(root, openRatio, immediate = false) {
  for (const group of root.userData.frontMotionGroups ?? []) {
    const motion = group.userData.frontMotion;
    motion.targetOpen = openRatio;
    if (immediate) {
      motion.currentOpen = openRatio;
      applyFrontMotion(group);
    }
  }
}

function applyFrontMotion(group) {
  const motion = group.userData.frontMotion;
  group.position.copy(motion.closedPosition);
  group.rotation.set(0, 0, 0);
  if (motion.type === "drawer") {
    group.position.x += motion.openDirection.x * motion.openDistance * motion.currentOpen;
    group.position.y += motion.openDirection.y * motion.openDistance * motion.currentOpen;
  } else if (motion.type === "horizontal_door") {
    group.rotation.x = motion.openAngle * motion.currentOpen;
  } else {
    group.rotation.z = motion.openAngle * motion.currentOpen;
  }
}

function updateFrontAnimations(delta) {
  if (delta <= 0) return;
  for (const root of objectMap.values()) {
    for (const group of root.userData.frontMotionGroups ?? []) {
      const motion = group.userData.frontMotion;
      if (Math.abs(motion.currentOpen - motion.targetOpen) < 0.001) {
        motion.currentOpen = motion.targetOpen;
      } else {
        motion.currentOpen = THREE.MathUtils.damp(motion.currentOpen, motion.targetOpen, 11, delta);
      }
      applyFrontMotion(group);
    }
  }
}

function positionAppliance(object, applianceId, item, cabinetAsset) {
  object.position.copy(getApplianceLocalPosition(applianceId, item, cabinetAsset));
}

function getApplianceLocalPosition(applianceId, item, cabinetAsset) {
  const worktop = WORKTOP_ASSETS[sceneState.worktop.assetId];
  const worktopTopGlobal = sceneState.worktop.elevation + worktop.thickness;
  const worktopTopLocal = worktopTopGlobal - item.position[2];
  const applianceAsset = APPLIANCE_ASSETS[applianceId];
  const category = applianceAsset?.category;
  const applianceSlot = (cabinetAsset.applianceSlots ?? [])
    .find((slot) => slot.interfaceId === applianceAsset?.interfaceId)?.slot;

  if (
    applianceSlot?.local_center
    && applianceSlot?.niche_size
    && applianceAsset?.origin === "bottom_center_of_installation_body"
  ) {
    const [x, , centerZ] = applianceSlot.local_center;
    const nicheHeight = applianceSlot.niche_size[2];
    const frontPlaneY = applianceSlot.front_flush_y ?? cabinetAsset.dimensions[1] / 2;
    const applianceDepth = applianceAsset.bodySize?.[1] ?? applianceSlot.niche_size[1];
    const centerY = frontPlaneY - applianceDepth / 2;
    return new THREE.Vector3(x, centerY, centerZ - nicheHeight / 2);
  }

  switch (category) {
    case "sink":
    case "cooktop": {
      const [x = 0, y = 0] = applianceSlot?.local_center ?? [];
      return new THREE.Vector3(x, y + 0.02, worktopTopLocal);
    }
    case "faucet": {
      const [x = 0, y = -0.22] = applianceSlot?.local_center ?? [];
      return new THREE.Vector3(x, y, worktopTopLocal);
    }
    default:
      return new THREE.Vector3(0, 0, cabinetAsset.dimensions[2] / 2);
  }
}

async function rebuildEntireScene() {
  setSelected(null);
  await rebuildRoomEnvironment();
  for (const root of objectMap.values()) sceneRoot.remove(root);
  objectMap.clear();
  for (const item of sceneState.objects) normalizeItemAppliances(item);
  await rebuildWorktop();
  await Promise.all(sceneState.objects.map((item) => rebuildItem(item.id)));
  refreshSceneTree();
  dom.sceneName.textContent = sceneState.name;
  dom.worktopStyle.value = sceneState.worktop.assetId;
}

function rebuildWorktop() {
  disposeObjectChildren(worktopRoot);
  worktopRoot.clear();
  const asset = WORKTOP_ASSETS[sceneState.worktop.assetId];
  if (!asset) throw new Error(`未知台面资产：${sceneState.worktop.assetId}`);
  const cutouts = collectWorktopCutouts();

  for (const region of sceneState.worktop.regions) {
    const outline = region.outline.map(([x, y]) => new THREE.Vector2(x, y));
    if (THREE.ShapeUtils.isClockWise(outline)) outline.reverse();
    const shape = new THREE.Shape(outline);

    for (const cutout of cutouts) {
      const path = createWorktopCutoutPath(cutout, outline);
      if (path) shape.holes.push(path);
    }

    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: asset.thickness,
      bevelEnabled: false,
      curveSegments: 32,
    });
    const model = new THREE.Mesh(geometry, createCatalogMaterial(asset.material));
    model.name = `worktop_${region.id}`;
    model.position.z = sceneState.worktop.elevation;
    model.castShadow = true;
    model.receiveShadow = true;
    worktopRoot.add(model);
  }

  rebuildProceduralFinishes();
}

function rebuildProceduralFinishes() {
  disposeObjectChildren(finishRoot);
  finishRoot.clear();

  const plinthMaterial = new THREE.MeshStandardMaterial({ color: 0x252525, roughness: 0.66, metalness: 0.08 });
  const backsplashMaterial = createBacksplashMaterial();
  const worktopAsset = WORKTOP_ASSETS[sceneState.worktop.assetId];
  const worktopEdgeMaterial = createCatalogMaterial(worktopAsset.material);
  worktopEdgeMaterial.color.multiplyScalar(0.82);
  worktopEdgeMaterial.roughness = Math.min(1, worktopEdgeMaterial.roughness + 0.08);

  for (const item of sceneState.objects) {
    const asset = CABINET_ASSETS[item.cabinetAssetId];
    if (asset) addCabinetFinishes(item, asset, plinthMaterial);
  }

  addWorktopEdgeBands(worktopAsset, worktopEdgeMaterial);
  addBacksplashes(backsplashMaterial);
  addInsideCornerTrims(backsplashMaterial);
}

function createBacksplashMaterial() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  context.fillStyle = "#e8e5de";
  context.fillRect(0, 0, 256, 256);
  context.strokeStyle = "rgba(145, 142, 136, 0.32)";
  context.lineWidth = 2;
  for (let y = 0; y <= 256; y += 64) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(256, y);
    context.stroke();
  }
  for (let row = 0; row < 4; row += 1) {
    const offset = row % 2 === 0 ? 0 : 64;
    for (let x = offset; x <= 256; x += 128) {
      context.beginPath();
      context.moveTo(x, row * 64);
      context.lineTo(x, (row + 1) * 64);
      context.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 2);
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return new THREE.MeshStandardMaterial({ color: 0xf4f1eb, map: texture, roughness: 0.48, metalness: 0 });
}

function addCabinetFinishes(item, asset, plinthMaterial) {
  if (asset.construction.carrier_only) return;
  const [width, depth, height] = asset.dimensions;
  const floorElevation = sceneState.room.floorElevation;
  const bottomGap = Math.max(0, item.position[2] - floorElevation);
  const isFloorCabinet = ["base", "high"].includes(asset.family);
  const panelDefinition = FRONT_ASSETS[item.frontAssetId]?.material
    ?? { base_color: "#F1F0EB", roughness: 0.68, metallic: 0 };
  const panelMaterial = createCatalogMaterial(panelDefinition);

  if (isFloorCabinet && bottomGap > 0.01) {
    addCabinetLocalBox(
      `plinth_${item.id}`,
      item,
      [width, Math.max(0.05, depth - FINISH_DEFAULTS.plinthFrontRecess), bottomGap],
      [0, -FINISH_DEFAULTS.plinthFrontRecess / 2, -bottomGap / 2],
      plinthMaterial,
    );
  }

  if (asset.cornerGeometry) return;
  for (const side of [-1, 1]) {
    if (cabinetSideHasNeighbour(item, asset, side)) continue;
    addCabinetLocalBox(
      `end_panel_${item.id}_${side < 0 ? "left" : "right"}`,
      item,
      [FINISH_DEFAULTS.panelThickness, depth + 0.012, height],
      [side * (width / 2 + FINISH_DEFAULTS.panelThickness / 2), 0.006, height / 2],
      panelMaterial,
    );

    const gap = distanceFromCabinetSideToRoom(item, asset, side);
    if (gap <= FINISH_DEFAULTS.panelThickness || gap > FINISH_DEFAULTS.fillerMaxWidth) continue;
    if (cabinetFillerHitsOpening(item, asset, side, gap)) continue;
    addCabinetLocalBox(
      `filler_${item.id}_${side < 0 ? "left" : "right"}`,
      item,
      [gap, FINISH_DEFAULTS.panelThickness, height],
      [side * (width / 2 + gap / 2), depth / 2 + FINISH_DEFAULTS.panelThickness / 2, height / 2],
      panelMaterial,
    );
  }
}

function cabinetFillerHitsOpening(item, asset, side, gap) {
  const localCenter = new THREE.Vector2(
    side * (asset.dimensions[0] / 2 + gap / 2),
    asset.dimensions[1] / 2 + FINISH_DEFAULTS.panelThickness / 2,
  ).rotateAround(new THREE.Vector2(), item.rotationZ ?? 0)
    .add(new THREE.Vector2(item.position[0], item.position[1]));
  const rotationZ = item.rotationZ ?? 0;
  const fillerEnvelope = {
    centerX: localCenter.x,
    centerY: localCenter.y,
    minZ: item.position[2],
    maxZ: item.position[2] + asset.dimensions[2],
    axisX: { x: Math.cos(rotationZ), y: Math.sin(rotationZ) },
    axisY: { x: -Math.sin(rotationZ), y: Math.cos(rotationZ) },
    halfWidth: gap / 2,
    halfDepth: FINISH_DEFAULTS.panelThickness / 2,
  };
  return sceneState.room.openings.some((opening) => {
    const openingEnvelope = openingCollisionEnvelope(sceneState.room, opening);
    return openingEnvelope && cabinetEnvelopesOverlap(fillerEnvelope, openingEnvelope);
  });
}

function addCabinetLocalBox(name, item, size, localPosition, material) {
  const point = new THREE.Vector2(localPosition[0], localPosition[1])
    .rotateAround(new THREE.Vector2(), item.rotationZ ?? 0)
    .add(new THREE.Vector2(item.position[0], item.position[1]));
  addWorldBox(
    finishRoot,
    name,
    size,
    [point.x, point.y, item.position[2] + localPosition[2]],
    item.rotationZ ?? 0,
    material,
  );
}

function addWorldBox(parent, name, size, position, rotationZ, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.rotation.z = rotationZ;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function cabinetSideHasNeighbour(item, asset, side) {
  const sidePoint = new THREE.Vector2(side * (asset.dimensions[0] / 2 + 0.006), 0)
    .rotateAround(new THREE.Vector2(), item.rotationZ ?? 0)
    .add(new THREE.Vector2(item.position[0], item.position[1]));
  const itemMinZ = item.position[2];
  const itemMaxZ = item.position[2] + asset.dimensions[2];

  return sceneState.objects.some((other) => {
    if (other.id === item.id) return false;
    const otherAsset = CABINET_ASSETS[other.cabinetAssetId];
    if (!otherAsset) return false;
    const overlapZ = Math.min(itemMaxZ, other.position[2] + otherAsset.dimensions[2])
      - Math.max(itemMinZ, other.position[2]);
    if (overlapZ <= 0.05) return false;
    return pointInsideCabinetEnvelope(sidePoint, createCabinetEnvelope(other), 0.012);
  });
}

function pointInsideCabinetEnvelope(point, envelope, tolerance = 0) {
  const deltaX = point.x - envelope.centerX;
  const deltaY = point.y - envelope.centerY;
  const localX = deltaX * envelope.axisX.x + deltaY * envelope.axisX.y;
  const localY = deltaX * envelope.axisY.x + deltaY * envelope.axisY.y;
  return Math.abs(localX) <= envelope.halfWidth + tolerance
    && Math.abs(localY) <= envelope.halfDepth + tolerance;
}

function distanceFromCabinetSideToRoom(item, asset, side) {
  const origin = new THREE.Vector2(side * asset.dimensions[0] / 2, 0)
    .rotateAround(new THREE.Vector2(), item.rotationZ ?? 0)
    .add(new THREE.Vector2(item.position[0], item.position[1]));
  const direction = new THREE.Vector2(side, 0).rotateAround(new THREE.Vector2(), item.rotationZ ?? 0);
  const outline = sceneState.room.outline.map(([x, y]) => new THREE.Vector2(x, y));
  let nearest = Infinity;
  for (let index = 0; index < outline.length; index += 1) {
    const distance = raySegmentDistance(origin, direction, outline[index], outline[(index + 1) % outline.length]);
    if (distance !== null && distance < nearest) nearest = distance;
  }
  return nearest;
}

function raySegmentDistance(origin, direction, start, end) {
  const edge = end.clone().sub(start);
  const offset = start.clone().sub(origin);
  const denominator = direction.x * edge.y - direction.y * edge.x;
  if (Math.abs(denominator) <= 1e-7) return null;
  const rayT = (offset.x * edge.y - offset.y * edge.x) / denominator;
  const segmentT = (offset.x * direction.y - offset.y * direction.x) / denominator;
  if (rayT < -1e-7 || segmentT < -1e-7 || segmentT > 1 + 1e-7) return null;
  return Math.max(0, rayT);
}

function addWorktopEdgeBands(asset, material) {
  const roomOutline = sceneState.room.outline.map(([x, y]) => new THREE.Vector2(x, y));
  for (const region of sceneState.worktop.regions) {
    const outline = region.outline.map(([x, y]) => new THREE.Vector2(x, y));
    for (let index = 0; index < outline.length; index += 1) {
      const start = outline[index];
      const end = outline[(index + 1) % outline.length];
      if (segmentOnRoomBoundary(start, end, roomOutline)) continue;
      const edge = end.clone().sub(start);
      const length = edge.length();
      if (length <= 0.01) continue;
      const center = start.clone().add(end).multiplyScalar(0.5);
      addWorldBox(
        finishRoot,
        `worktop_edge_${region.id}_${index + 1}`,
        [length, FINISH_DEFAULTS.worktopEdgeThickness, asset.thickness + 0.004],
        [center.x, center.y, sceneState.worktop.elevation + asset.thickness / 2],
        Math.atan2(edge.y, edge.x),
        material,
      );
    }
  }
}

function segmentOnRoomBoundary(start, end, roomOutline, tolerance = 0.02) {
  const midpoint = start.clone().add(end).multiplyScalar(0.5);
  return roomOutline.some((wallStart, index) => {
    const wallEnd = roomOutline[(index + 1) % roomOutline.length];
    return pointDistanceToSegment(start, wallStart, wallEnd) <= tolerance
      && pointDistanceToSegment(midpoint, wallStart, wallEnd) <= tolerance
      && pointDistanceToSegment(end, wallStart, wallEnd) <= tolerance;
  });
}

function pointDistanceToSegment(point, start, end) {
  const edge = end.clone().sub(start);
  const lengthSquared = edge.lengthSq();
  if (lengthSquared <= 1e-12) return point.distanceTo(start);
  const t = THREE.MathUtils.clamp(point.clone().sub(start).dot(edge) / lengthSquared, 0, 1);
  return point.distanceTo(start.clone().addScaledVector(edge, t));
}

function addBacksplashes(material) {
  const roomOutline = sceneState.room.outline.map(([x, y]) => new THREE.Vector2(x, y));
  const worktopTop = sceneState.worktop.elevation + WORKTOP_ASSETS[sceneState.worktop.assetId].thickness;
  for (let wallIndex = 0; wallIndex < roomOutline.length; wallIndex += 1) {
    const wallStart = roomOutline[wallIndex];
    const wallEnd = roomOutline[(wallIndex + 1) % roomOutline.length];
    const wallEdge = wallEnd.clone().sub(wallStart);
    const wallDirection = wallEdge.clone().normalize();
    const inwardNormal = new THREE.Vector2(-wallDirection.y, wallDirection.x);
    for (const region of sceneState.worktop.regions) {
      const regionOutline = region.outline.map(([x, y]) => new THREE.Vector2(x, y));
      for (let edgeIndex = 0; edgeIndex < regionOutline.length; edgeIndex += 1) {
        const overlap = collinearSegmentOverlap(
          wallStart,
          wallEnd,
          regionOutline[edgeIndex],
          regionOutline[(edgeIndex + 1) % regionOutline.length],
        );
        if (!overlap || overlap.length <= 0.04) continue;
        const overlapStart = overlap.start.clone().sub(wallStart).dot(wallDirection);
        const overlapEnd = overlap.end.clone().sub(wallStart).dot(wallDirection);
        const backsplashMinZ = worktopTop;
        const backsplashMaxZ = worktopTop + FINISH_DEFAULTS.backsplashHeight;
        const cuts = sceneState.room.openings
          .filter((opening) => opening.wallIndex === wallIndex)
          .filter((opening) => {
            const geometry = resolveRoomOpening(sceneState.room, opening);
            return geometry && backsplashMinZ < geometry.maxZ && geometry.minZ < backsplashMaxZ;
          })
          .map((opening) => ({
            start: opening.centerOffset - opening.width / 2,
            end: opening.centerOffset + opening.width / 2,
          }));
        for (const [segmentIndex, segment] of subtractLinearIntervals(overlapStart, overlapEnd, cuts).entries()) {
          if (segment.end - segment.start <= 0.04) continue;
          const segmentStart = wallStart.clone().addScaledVector(wallDirection, segment.start);
          const segmentEnd = wallStart.clone().addScaledVector(wallDirection, segment.end);
          const center = segmentStart.add(segmentEnd).multiplyScalar(0.5)
            .addScaledVector(inwardNormal, FINISH_DEFAULTS.backsplashThickness / 2);
          addWorldBox(
            finishRoot,
            `backsplash_${wallIndex + 1}_${region.id}_${edgeIndex + 1}_${segmentIndex + 1}`,
            [segment.end - segment.start, FINISH_DEFAULTS.backsplashThickness, FINISH_DEFAULTS.backsplashHeight],
            [center.x, center.y, worktopTop + FINISH_DEFAULTS.backsplashHeight / 2],
            Math.atan2(wallEdge.y, wallEdge.x),
            material,
          );
        }
      }
    }
  }
}

function subtractLinearIntervals(from, to, cuts) {
  const result = [];
  let cursor = Math.min(from, to);
  const end = Math.max(from, to);
  const sortedCuts = cuts
    .map((cut) => ({ start: Math.max(cursor, cut.start), end: Math.min(end, cut.end) }))
    .filter((cut) => cut.end > cut.start)
    .sort((left, right) => left.start - right.start);
  for (const cut of sortedCuts) {
    if (cut.start > cursor) result.push({ start: cursor, end: cut.start });
    cursor = Math.max(cursor, cut.end);
  }
  if (cursor < end) result.push({ start: cursor, end });
  return result;
}

function collinearSegmentOverlap(a, b, c, d, tolerance = 0.02) {
  const ab = b.clone().sub(a);
  const cd = d.clone().sub(c);
  if (Math.abs(ab.x * cd.y - ab.y * cd.x) > tolerance) return null;
  if (pointDistanceToSegment(c, a, b) > tolerance && pointDistanceToSegment(d, a, b) > tolerance) return null;
  const direction = ab.clone().normalize();
  const abLength = ab.length();
  const cPosition = c.clone().sub(a).dot(direction);
  const dPosition = d.clone().sub(a).dot(direction);
  const from = Math.max(0, Math.min(cPosition, dPosition));
  const to = Math.min(abLength, Math.max(cPosition, dPosition));
  if (to - from <= tolerance) return null;
  return {
    start: a.clone().addScaledVector(direction, from),
    end: a.clone().addScaledVector(direction, to),
    length: to - from,
  };
}

function addInsideCornerTrims(material) {
  const roomOutline = sceneState.room.outline.map(([x, y]) => new THREE.Vector2(x, y));
  const worktopVertices = sceneState.worktop.regions.flatMap((region) => (
    region.outline.map(([x, y]) => new THREE.Vector2(x, y))
  ));
  const worktopTop = sceneState.worktop.elevation + WORKTOP_ASSETS[sceneState.worktop.assetId].thickness;
  for (let index = 0; index < roomOutline.length; index += 1) {
    const corner = roomOutline[index];
    if (!worktopVertices.some((point) => point.distanceTo(corner) <= 0.02)) continue;
    const previous = roomOutline[(index - 1 + roomOutline.length) % roomOutline.length];
    const next = roomOutline[(index + 1) % roomOutline.length];
    const inwardA = new THREE.Vector2(-(corner.y - previous.y), corner.x - previous.x).normalize();
    const inwardB = new THREE.Vector2(-(next.y - corner.y), next.x - corner.x).normalize();
    const offset = inwardA.add(inwardB).setLength(FINISH_DEFAULTS.backsplashThickness);
    addWorldBox(
      finishRoot,
      `corner_trim_${index + 1}`,
      [0.026, 0.026, FINISH_DEFAULTS.backsplashHeight],
      [corner.x + offset.x, corner.y + offset.y, worktopTop + FINISH_DEFAULTS.backsplashHeight / 2],
      0,
      material,
    );
  }
}

function collectWorktopCutouts() {
  const result = [];
  const zAxis = new THREE.Vector3(0, 0, 1);

  for (const item of sceneState.objects) {
    const cabinetAsset = CABINET_ASSETS[item.cabinetAssetId];
    if (!cabinetAsset) continue;
    for (const applianceId of item.applianceAssetIds ?? []) {
      const appliance = APPLIANCE_ASSETS[applianceId];
      if (!appliance?.worktopCutout) continue;
      const localPosition = getApplianceLocalPosition(applianceId, item, cabinetAsset);
      const worldPosition = localPosition
        .clone()
        .applyAxisAngle(zAxis, item.rotationZ ?? 0)
        .add(new THREE.Vector3(...item.position));
      result.push({
        ...appliance.worktopCutout,
        id: `${item.id}:${applianceId}`,
        center: new THREE.Vector2(worldPosition.x, worldPosition.y),
        rotation: item.rotationZ ?? 0,
      });
    }
  }
  return result;
}

function createWorktopCutoutPath(cutout, outline) {
  if (cutout.shape === "circle") {
    const radius = cutout.diameter / 2;
    const samples = Array.from({ length: 16 }, (_, index) => {
      const angle = index * Math.PI * 2 / 16;
      return new THREE.Vector2(
        cutout.center.x + Math.cos(angle) * radius,
        cutout.center.y + Math.sin(angle) * radius,
      );
    });
    if (!samples.every((point) => pointInsidePolygon(point, outline))) return null;
    const path = new THREE.Path();
    path.absellipse(cutout.center.x, cutout.center.y, radius, radius, 0, Math.PI * 2, true);
    return path;
  }

  if (cutout.shape === "rectangle") {
    const [width, cutoutDepth] = cutout.size;
    const corners = [
      new THREE.Vector2(-width / 2, -cutoutDepth / 2),
      new THREE.Vector2(-width / 2, cutoutDepth / 2),
      new THREE.Vector2(width / 2, cutoutDepth / 2),
      new THREE.Vector2(width / 2, -cutoutDepth / 2),
    ].map((point) => point.rotateAround(new THREE.Vector2(), cutout.rotation).add(cutout.center));
    const samples = corners.flatMap((point, index) => {
      const next = corners[(index + 1) % corners.length];
      return [point, point.clone().add(next).multiplyScalar(0.5)];
    });
    if (!samples.every((point) => pointInsidePolygon(point, outline))) return null;
    const path = new THREE.Path();
    path.moveTo(corners[0].x, corners[0].y);
    for (const point of corners.slice(1)) path.lineTo(point.x, point.y);
    path.closePath();
    return path;
  }

  console.warn(`不支持的台面开孔形状：${cutout.shape}`);
  return null;
}

function pointInsidePolygon(point, polygon) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const a = polygon[previous];
    const b = polygon[current];
    const cross = (point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x);
    const onSegment = Math.abs(cross) < 1e-7
      && point.x >= Math.min(a.x, b.x) - 1e-7
      && point.x <= Math.max(a.x, b.x) + 1e-7
      && point.y >= Math.min(a.y, b.y) - 1e-7
      && point.y <= Math.max(a.y, b.y) + 1e-7;
    if (onSegment) return false;
    if (
      (a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) inside = !inside;
  }
  return inside;
}

function pointOnPolygonBoundary(point, polygon, epsilon = COLLISION_EPSILON) {
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    const edge = end.clone().sub(start);
    const offset = point.clone().sub(start);
    const cross = edge.x * offset.y - edge.y * offset.x;
    if (Math.abs(cross) > epsilon) continue;
    const dot = offset.dot(edge);
    if (dot >= -epsilon && dot <= edge.lengthSq() + epsilon) return true;
  }
  return false;
}

function pointInsideOrOnPolygon(point, polygon) {
  return pointOnPolygonBoundary(point, polygon) || pointInsidePolygon(point, polygon);
}

function segmentInsidePolygon(start, end, polygon) {
  const direction = end.clone().sub(start);
  const lengthSquared = direction.lengthSq();
  if (lengthSquared <= COLLISION_EPSILON ** 2) return pointInsideOrOnPolygon(start, polygon);

  const parameters = [0, 1];
  for (let index = 0; index < polygon.length; index += 1) {
    const edgeStart = polygon[index];
    const edgeEnd = polygon[(index + 1) % polygon.length];
    const edgeDirection = edgeEnd.clone().sub(edgeStart);
    const offset = edgeStart.clone().sub(start);
    const denominator = direction.x * edgeDirection.y - direction.y * edgeDirection.x;
    const offsetCrossDirection = offset.x * direction.y - offset.y * direction.x;

    if (Math.abs(denominator) <= COLLISION_EPSILON) {
      if (Math.abs(offsetCrossDirection) > COLLISION_EPSILON) continue;
      for (const point of [edgeStart, edgeEnd]) {
        const t = point.clone().sub(start).dot(direction) / lengthSquared;
        if (t > 0 && t < 1) parameters.push(t);
      }
      continue;
    }

    const t = (offset.x * edgeDirection.y - offset.y * edgeDirection.x) / denominator;
    const u = offsetCrossDirection / denominator;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) parameters.push(t);
  }

  parameters.sort((left, right) => left - right);
  const unique = parameters.filter((value, index) => index === 0 || Math.abs(value - parameters[index - 1]) > 1e-7);
  for (let index = 0; index < unique.length - 1; index += 1) {
    const midpointT = (unique[index] + unique[index + 1]) / 2;
    const midpoint = start.clone().addScaledVector(direction, midpointT);
    if (!pointInsideOrOnPolygon(midpoint, polygon)) return false;
  }
  return true;
}

function polygonContainedInPolygon(candidate, container) {
  if (!candidate.every((point) => pointInsideOrOnPolygon(point, container))) return false;
  return candidate.every((point, index) => (
    segmentInsidePolygon(point, candidate[(index + 1) % candidate.length], container)
  ));
}

function polygonSignedArea(points) {
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

function pointOnSegment(point, start, end, epsilon = 1e-7) {
  const edge = end.clone().sub(start);
  const offset = point.clone().sub(start);
  const cross = edge.x * offset.y - edge.y * offset.x;
  if (Math.abs(cross) > epsilon) return false;
  const dot = offset.dot(edge);
  return dot >= -epsilon && dot <= edge.lengthSq() + epsilon;
}

function segmentsIntersectOrTouch(a, b, c, d) {
  const cross = (start, end, point) => {
    const edge = end.clone().sub(start);
    const offset = point.clone().sub(start);
    return edge.x * offset.y - edge.y * offset.x;
  };
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  if (
    ((abC > 1e-7 && abD < -1e-7) || (abC < -1e-7 && abD > 1e-7))
    && ((cdA > 1e-7 && cdB < -1e-7) || (cdA < -1e-7 && cdB > 1e-7))
  ) return true;
  if (Math.abs(abC) <= 1e-7 && pointOnSegment(c, a, b)) return true;
  if (Math.abs(abD) <= 1e-7 && pointOnSegment(d, a, b)) return true;
  if (Math.abs(cdA) <= 1e-7 && pointOnSegment(a, c, d)) return true;
  return Math.abs(cdB) <= 1e-7 && pointOnSegment(b, c, d);
}

function polygonHasSelfIntersections(points) {
  for (let left = 0; left < points.length; left += 1) {
    const leftNext = (left + 1) % points.length;
    for (let right = left + 1; right < points.length; right += 1) {
      const rightNext = (right + 1) % points.length;
      if (left === right || leftNext === right || rightNext === left) continue;
      if (segmentsIntersectOrTouch(points[left], points[leftNext], points[right], points[rightNext])) return true;
    }
  }
  return false;
}

function disposeObjectChildren(root) {
  root.traverse((object) => {
    object.geometry?.dispose();
    if (Array.isArray(object.material)) {
      for (const material of object.material) material.dispose();
    } else {
      object.material?.dispose();
    }
  });
}

function scheduleWorktopRebuild() {
  if (worktopRebuildQueued) return;
  worktopRebuildQueued = true;
  requestAnimationFrame(() => {
    worktopRebuildQueued = false;
    rebuildWorktop();
  });
}

async function rebuildItem(id) {
  const item = findSceneItem(id);
  if (!item) return;
  const token = Symbol(id);
  rebuildTokens.set(id, token);
  const wasSelected = selectedId === id;
  const oldRoot = objectMap.get(id);
  if (oldRoot) {
    if (transformControls.object === oldRoot) transformControls.detach();
    sceneRoot.remove(oldRoot);
    objectMap.delete(id);
  }

  try {
    const root = await createSceneObjectAssembly(item);
    if (rebuildTokens.get(id) !== token) return;
    objectMap.set(id, root);
    sceneRoot.add(root);
    if (wasSelected) setSelected(id);
  } catch (error) {
    console.error(error);
    showToast(error.message, true);
  }
  refreshSceneTree();
}

async function rebuildItemsWithWorktopAppliances() {
  const affected = sceneState.objects.filter((item) =>
    item.applianceAssetIds?.some((id) => APPLIANCE_ASSETS[id]?.worktopCutout),
  );
  await Promise.all(affected.map((item) => rebuildItem(item.id)));
}

function onViewportPointerDown(event) {
  if (event.button !== 0 || transformControls.dragging || transformControls.axis) {
    pointerDownState = null;
    return;
  }
  pointerDownState = {
    x: event.clientX,
    y: event.clientY,
    time: performance.now(),
  };
}

function onViewportPointerUp(event) {
  if (event.button !== 0 || !pointerDownState || transformControls.dragging) {
    pointerDownState = null;
    return;
  }
  const distance = Math.hypot(
    event.clientX - pointerDownState.x,
    event.clientY - pointerDownState.y,
  );
  const duration = performance.now() - pointerDownState.time;
  pointerDownState = null;
  if (distance > 5 || duration > 500) return;

  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const intersections = raycaster.intersectObjects([...objectMap.values()], true);
  setSelected(intersections[0]?.object.userData.itemId ?? null);
}

function toggleSelectedFront() {
  const item = selectedId ? findSceneItem(selectedId) : null;
  const root = selectedId ? objectMap.get(selectedId) : null;
  const motionGroups = root?.userData.frontMotionGroups ?? [];
  if (!item || motionGroups.length === 0) {
    showToast("当前柜体没有可开合的门板或抽屉", true);
    return;
  }
  item.frontOpen = !Boolean(item.frontOpen);
  setFrontMotionState(root, item.frontOpen ? 1 : 0);
  updateOpenTool();
  showToast(item.frontOpen ? "正在打开柜门或抽屉" : "正在关闭柜门或抽屉");
}

function updateOpenTool() {
  const item = selectedId ? findSceneItem(selectedId) : null;
  const root = selectedId ? objectMap.get(selectedId) : null;
  const canOpen = (root?.userData.frontMotionGroups?.length ?? 0) > 0;
  const isOpen = canOpen && Boolean(item?.frontOpen);
  dom.openTool.disabled = !canOpen;
  dom.openTool.textContent = isOpen ? "CLOSE" : "OPEN";
  dom.openTool.title = isOpen ? "关闭柜门或抽屉 (O)" : "打开柜门或抽屉 (O)";
  dom.openTool.classList.toggle("active", isOpen);
}

function setSelected(id) {
  selectedId = id && objectMap.has(id) ? id : null;
  transformControls.detach();
  if (selectionBox) {
    scene.remove(selectionBox);
    selectionBox = null;
  }

  if (selectedId) {
    const root = objectMap.get(selectedId);
    selectionBox = new THREE.BoxHelper(root, 0xf0643c);
    scene.add(selectionBox);
    if (activeTool !== "select") transformControls.attach(root);
  }
  updateOpenTool();
  refreshSceneTree();
  refreshInspector();
}

function setTool(tool) {
  activeTool = tool;
  const buttons = {
    select: dom.selectTool,
    translate: dom.moveTool,
    rotate: dom.rotateTool,
  };
  for (const button of Object.values(buttons)) button.classList.remove("active");
  buttons[tool].classList.add("active");

  transformControls.detach();
  if (selectedId && tool !== "select") {
    transformControls.setMode(tool);
    transformControls.showX = tool !== "rotate";
    transformControls.showY = tool !== "rotate";
    transformControls.showZ = true;
    transformControls.showE = false;
    transformControls.showXYZE = false;
    transformControls.showXY = tool === "translate";
    transformControls.showXZ = false;
    transformControls.showYZ = false;
    transformControls.attach(objectMap.get(selectedId));
  }
}

function createCabinetEnvelope(item, position = item.position, rotationZ = item.rotationZ ?? 0) {
  const dimensions = sceneItemDimensions(item);
  if (!dimensions) throw new Error(`未知场景资产：${item.id}`);
  const cos = Math.cos(rotationZ);
  const sin = Math.sin(rotationZ);
  return {
    item,
    centerX: position[0],
    centerY: position[1],
    minZ: position[2],
    maxZ: position[2] + dimensions[2],
    axisX: { x: cos, y: sin },
    axisY: { x: -sin, y: cos },
    halfWidth: dimensions[0] / 2,
    halfDepth: dimensions[1] / 2,
  };
}

function projectionRadius(envelope, axis) {
  const xProjection = Math.abs(envelope.axisX.x * axis.x + envelope.axisX.y * axis.y);
  const yProjection = Math.abs(envelope.axisY.x * axis.x + envelope.axisY.y * axis.y);
  return envelope.halfWidth * xProjection + envelope.halfDepth * yProjection;
}

function cabinetEnvelopesOverlap(a, b) {
  if (a.maxZ <= b.minZ + COLLISION_EPSILON || b.maxZ <= a.minZ + COLLISION_EPSILON) return false;
  const delta = { x: b.centerX - a.centerX, y: b.centerY - a.centerY };
  for (const axis of [a.axisX, a.axisY, b.axisX, b.axisY]) {
    const centerDistance = Math.abs(delta.x * axis.x + delta.y * axis.y);
    if (centerDistance >= projectionRadius(a, axis) + projectionRadius(b, axis) - COLLISION_EPSILON) {
      return false;
    }
  }
  return true;
}

function envelopeFootprint(envelope) {
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sy]) => new THREE.Vector2(
    envelope.centerX
      + sx * envelope.halfWidth * envelope.axisX.x
      + sy * envelope.halfDepth * envelope.axisY.x,
    envelope.centerY
      + sx * envelope.halfWidth * envelope.axisX.y
      + sy * envelope.halfDepth * envelope.axisY.y,
  ));
}

function envelopeFitsRoom(envelope, room = sceneState.room) {
  const floorElevation = room.floorElevation;
  const maxZ = floorElevation + room.height;
  if (envelope.minZ < floorElevation - COLLISION_EPSILON || envelope.maxZ > maxZ + COLLISION_EPSILON) {
    return false;
  }
  const outline = room.outline.map(([x, y]) => new THREE.Vector2(x, y));
  return polygonContainedInPolygon(envelopeFootprint(envelope), outline);
}

function validateCabinetTransform(item, position, rotationZ) {
  const candidate = createCabinetEnvelope(item, position, rotationZ);
  if (!envelopeFitsRoom(candidate)) return { valid: false, reason: "房间边界" };
  for (const opening of sceneState.room.openings) {
    const openingEnvelope = openingCollisionEnvelope(sceneState.room, opening);
    if (openingEnvelope && cabinetEnvelopesOverlap(candidate, openingEnvelope)) {
      return { valid: false, reason: `${opening.type === "door" ? "门" : "窗"} ${opening.id}` };
    }
  }
  for (const other of sceneState.objects) {
    if (other.id === item.id || !sceneItemDimensions(other)) continue;
    if (cabinetEnvelopesOverlap(candidate, createCabinetEnvelope(other))) {
      return { valid: false, reason: other.name };
    }
  }
  return { valid: true, reason: null };
}

function interpolateAngle(start, delta, t) {
  return start + delta * t;
}

function resolveCabinetTransform(item, targetPosition, targetRotationZ) {
  const startPosition = [...item.position];
  const startRotationZ = item.rotationZ ?? 0;
  const rotationDelta = Math.atan2(
    Math.sin(targetRotationZ - startRotationZ),
    Math.cos(targetRotationZ - startRotationZ),
  );
  const distance = Math.hypot(
    targetPosition[0] - startPosition[0],
    targetPosition[1] - startPosition[1],
    targetPosition[2] - startPosition[2],
  );
  const stepCount = Math.max(
    1,
    Math.ceil(distance / COLLISION_PATH_STEP),
    Math.ceil(Math.abs(rotationDelta) / COLLISION_ROTATION_STEP),
  );
  let lastValidT = 0;

  for (let step = 1; step <= stepCount; step += 1) {
    const t = step / stepCount;
    const position = startPosition.map((value, index) =>
      THREE.MathUtils.lerp(value, targetPosition[index], t));
    const rotationZ = interpolateAngle(startRotationZ, rotationDelta, t);
    const validation = validateCabinetTransform(item, position, rotationZ);
    if (!validation.valid) {
      let low = lastValidT;
      let high = t;
      for (let iteration = 0; iteration < 14; iteration += 1) {
        const midpoint = (low + high) / 2;
        const midpointPosition = startPosition.map((value, index) =>
          THREE.MathUtils.lerp(value, targetPosition[index], midpoint));
        const midpointRotation = interpolateAngle(startRotationZ, rotationDelta, midpoint);
        if (validateCabinetTransform(item, midpointPosition, midpointRotation).valid) low = midpoint;
        else high = midpoint;
      }
      return {
        position: startPosition.map((value, index) =>
          THREE.MathUtils.lerp(value, targetPosition[index], low)),
        rotationZ: interpolateAngle(startRotationZ, rotationDelta, low),
        blockedBy: validation.reason,
      };
    }
    lastValidT = t;
  }

  return { position: targetPosition, rotationZ: targetRotationZ, blockedBy: null };
}

function applyConstrainedTransform(item, targetPosition, targetRotationZ, notify = true) {
  const root = objectMap.get(item.id);
  if (!root) return false;
  const resolved = resolveCabinetTransform(item, targetPosition, targetRotationZ);
  item.position = resolved.position.map(roundNumber);
  item.rotationZ = roundNumber(resolved.rotationZ);
  root.position.fromArray(item.position);
  root.rotation.z = item.rotationZ;
  if (resolved.blockedBy && notify && performance.now() - lastCollisionToastTime > 700) {
    showToast(`已停止移动：碰到${resolved.blockedBy}`);
    lastCollisionToastTime = performance.now();
  }
  scheduleWorktopRebuild();
  if (selectionBox) selectionBox.update();
  updateTransformInputs(item);
  return !resolved.blockedBy;
}

function applyRotationWithoutCollision(item, targetRotationZ) {
  const root = objectMap.get(item.id);
  if (!root) return;
  item.rotationZ = roundNumber(targetRotationZ);
  root.position.fromArray(item.position);
  root.rotation.z = item.rotationZ;
  scheduleWorktopRebuild();
  if (selectionBox) selectionBox.update();
  updateTransformInputs(item);
}

function syncSelectedTransformFromObject() {
  if (!selectedId) return;
  const root = objectMap.get(selectedId);
  const item = findSceneItem(selectedId);
  if (!root || !item) return;
  if (transformControls.getMode() === "rotate") {
    applyRotationWithoutCollision(item, root.rotation.z);
  } else {
    applyConstrainedTransform(item, root.position.toArray(), item.rotationZ ?? 0);
  }
}

function updateTransformInputs(item) {
  for (const [axis, index] of [["x", 0], ["y", 1], ["z", 2]]) {
    const input = dom.inspectorContent.querySelector(`[data-transform="${axis}"]`);
    if (input && document.activeElement !== input) input.value = item.position[index].toFixed(3);
  }
  const yaw = dom.inspectorContent.querySelector('[data-transform="yaw"]');
  if (yaw && document.activeElement !== yaw) {
    yaw.value = THREE.MathUtils.radToDeg(item.rotationZ ?? 0).toFixed(1);
  }
}

function refreshSceneTree() {
  dom.objectCount.textContent = sceneState.objects.length;
  dom.sceneTree.innerHTML = sceneState.objects
    .map((item) => {
      const cabinet = CABINET_ASSETS[item.cabinetAssetId];
      const asset = cabinet ?? standaloneAssetForItem(item);
      const kind = cabinet?.family ?? item.assetKind ?? "base";
      return `
        <button class="scene-row ${item.id === selectedId ? "selected" : ""}" type="button" data-scene-id="${item.id}">
          <span class="scene-row-icon ${kind}">${cabinet?.family === "wall" ? "▱" : item.assetKind ? "◇" : "▰"}</span>
          <span><strong>${item.name}</strong><small>${asset?.label ?? item.cabinetAssetId ?? item.assetId}</small></span>
        </button>
      `;
    })
    .join("");
}

function cabinetApplianceInterfaceIds(cabinetAsset) {
  return (cabinetAsset.applianceSlots ?? []).map((slot) => slot.interfaceId);
}

function compatibleAppliances(interfaceId) {
  return Object.values(APPLIANCE_ASSETS).filter((asset) => asset.interfaceId === interfaceId);
}

function selectedApplianceForInterface(item, interfaceId) {
  return (item.applianceAssetIds ?? [])
    .map((id) => APPLIANCE_ASSETS[id])
    .find((asset) => asset?.interfaceId === interfaceId)?.id ?? null;
}

function applianceSlotLabel(interfaceId) {
  const category = compatibleAppliances(interfaceId)[0]?.category;
  const categoryLabels = {
    oven: "烤箱",
    sink: "水槽",
    cooktop: "灶台",
    faucet: "水龙头",
    fridge: "冰箱",
    extractor_hood: "油烟机",
    dishwasher: "洗碗机",
  };
  return `${categoryLabels[category] ?? "电器"} · ${interfaceId}`;
}

function normalizeItemAppliances(item) {
  const cabinetAsset = CABINET_ASSETS[item.cabinetAssetId];
  if (!cabinetAsset) return;
  item.applianceAssetIds = cabinetApplianceInterfaceIds(cabinetAsset)
    .map((interfaceId) =>
      selectedApplianceForInterface(item, interfaceId) ?? compatibleAppliances(interfaceId)[0]?.id)
    .filter(Boolean);
}

function applianceEditorHtml(item, cabinetAsset) {
  const interfaceIds = cabinetApplianceInterfaceIds(cabinetAsset);
  if (!interfaceIds.length) return "";
  return `
    <section class="inspector-section">
      <h3>Appliances</h3>
      <p class="inspector-note">每个槽位只能替换为相同接口的电器。</p>
      ${interfaceIds.map((interfaceId) => {
        const compatible = compatibleAppliances(interfaceId);
        const selectedId = selectedApplianceForInterface(item, interfaceId);
        return `
          <label class="field-label" for="appliance-${interfaceId}">${applianceSlotLabel(interfaceId)}</label>
          <select
            id="appliance-${interfaceId}"
            class="select-control"
            data-appliance-interface="${interfaceId}"
            ${compatible.length ? "" : "disabled"}
          >
            ${compatible.length
              ? compatible.map((asset) => `<option value="${asset.id}" ${asset.id === selectedId ? "selected" : ""}>${asset.label}</option>`).join("")
              : '<option value="">当前没有兼容电器</option>'}
          </select>
        `;
      }).join("")}
    </section>
  `;
}

function refreshInspector() {
  const item = selectedId ? findSceneItem(selectedId) : null;
  if (!item) {
    dom.inspectorTitle.textContent = "未选择对象";
    dom.inspectorSubtitle.textContent = "点击场景中的柜体开始编辑。";
    dom.inspectorContent.className = "inspector-content empty-inspector";
    dom.inspectorContent.innerHTML = '<div class="empty-icon">◇</div><p>可以修改位置、朝向、柜体、门板、拉手和电器。</p>';
    return;
  }

  if (!item.cabinetAssetId) {
    refreshStandaloneInspector(item);
    return;
  }

  const cabinet = CABINET_ASSETS[item.cabinetAssetId];
  dom.inspectorTitle.textContent = item.name;
  dom.inspectorSubtitle.textContent = cabinet.label;
  dom.inspectorContent.className = "inspector-content";
  dom.inspectorContent.innerHTML = `
    <section class="inspector-section">
      <h3>对象</h3>
      <label class="field-label" for="item-name">名称</label>
      <input id="item-name" class="text-control" value="${item.name}" />
      <label class="field-label" for="cabinet-select">柜体类型</label>
      <select id="cabinet-select" class="select-control">${cabinetOptionsHtml(item.cabinetAssetId)}</select>
      <div class="metadata-row"><span>尺寸</span><strong>${formatDimensions(cabinet.dimensions)}</strong></div>
      <div class="metadata-row"><span>坐标系</span><strong>X / Y / Z</strong></div>
    </section>

    <section class="inspector-section">
      <h3>Transform</h3>
      <div class="vector-grid">
        ${numberField("X", "x", item.position[0], 0.05)}
        ${numberField("Y", "y", item.position[1], 0.05)}
        ${numberField("Z", "z", item.position[2], 0.05)}
      </div>
      ${numberField("绕 Z 旋转", "yaw", THREE.MathUtils.radToDeg(item.rotationZ ?? 0), 90, "wide")}
    </section>

    <section class="inspector-section">
      <h3>Front</h3>
      <label class="field-label" for="front-select">门板与布局</label>
      <select id="front-select" class="select-control">
        <option value="">无 front</option>
        ${optionsHtml(FRONT_ASSETS, item.frontAssetId)}
      </select>
      <label class="field-label" for="handle-select">拉手</label>
      <select id="handle-select" class="select-control" ${item.frontAssetId ? "" : "disabled"}>
        <option value="">无拉手</option>
        ${handleOptionsHtml(item.frontAssetId, item.handleAssetId)}
      </select>
    </section>

    ${applianceEditorHtml(item, cabinet)}

    <button id="inspector-delete" class="button delete-wide" type="button">删除这个柜体</button>
  `;

  bindInspectorEvents(item);
}

function refreshStandaloneInspector(item) {
  const asset = standaloneAssetForItem(item);
  dom.inspectorTitle.textContent = item.name;
  dom.inspectorSubtitle.textContent = asset.label;
  dom.inspectorContent.className = "inspector-content";
  dom.inspectorContent.innerHTML = `
    <section class="inspector-section">
      <h3>独立组件</h3>
      <label class="field-label" for="item-name">名称</label>
      <input id="item-name" class="text-control" value="${item.name}" />
      <div class="metadata-row"><span>类别</span><strong>${item.assetKind} / ${asset.category}</strong></div>
      <div class="metadata-row"><span>资产</span><strong>${asset.label}</strong></div>
      <div class="metadata-row"><span>尺寸</span><strong>${formatDimensions(asset.bodySize)}</strong></div>
    </section>
    <section class="inspector-section">
      <h3>Transform</h3>
      <div class="vector-grid">
        ${numberField("X", "x", item.position[0], 0.05)}
        ${numberField("Y", "y", item.position[1], 0.05)}
        ${numberField("Z", "z", item.position[2], 0.05)}
      </div>
      ${numberField("绕 Z 旋转", "yaw", THREE.MathUtils.radToDeg(item.rotationZ ?? 0), 90, "wide")}
    </section>
    <button id="inspector-delete" class="button delete-wide" type="button">删除这个组件</button>
  `;
  bindCommonInspectorEvents(item);
}

function bindCommonInspectorEvents(item) {
  dom.inspectorContent.querySelector("#item-name").addEventListener("change", (event) => {
    item.name = event.target.value.trim() || item.name;
    refreshSceneTree();
    refreshInspector();
  });
  for (const input of dom.inspectorContent.querySelectorAll("[data-transform]")) {
    input.addEventListener("change", () => {
      const key = input.dataset.transform;
      const value = Number(input.value);
      if (!Number.isFinite(value)) return refreshInspector();
      const targetPosition = [...item.position];
      if (key === "yaw") applyRotationWithoutCollision(item, THREE.MathUtils.degToRad(value));
      else {
        targetPosition[{ x: 0, y: 1, z: 2 }[key]] = value;
        applyConstrainedTransform(item, targetPosition, item.rotationZ ?? 0);
      }
    });
  }
  dom.inspectorContent.querySelector("#inspector-delete").addEventListener("click", deleteSelected);
}

function bindInspectorEvents(item) {
  bindCommonInspectorEvents(item);

  dom.inspectorContent.querySelector("#cabinet-select").addEventListener("change", async (event) => {
    const previousAssetId = item.cabinetAssetId;
    item.cabinetAssetId = event.target.value;
    const validation = validateCabinetTransform(item, item.position, item.rotationZ ?? 0);
    if (!validation.valid) {
      item.cabinetAssetId = previousAssetId;
      showToast(`无法替换：新柜体会碰到${validation.reason}`, true);
      refreshInspector();
      return;
    }
    applyCabinetDefaults(item);
    await rebuildItem(item.id);
    rebuildWorktop();
    refreshInspector();
  });

  dom.inspectorContent.querySelector("#front-select").addEventListener("change", async (event) => {
    item.frontAssetId = event.target.value || null;
    item.frontOpen = false;
    if (!item.frontAssetId) item.handleAssetId = null;
    if (item.frontAssetId && !isHandleCompatibleWithFront(item.handleAssetId, item.frontAssetId)) {
      item.handleAssetId = defaultHandleForFront(item.frontAssetId);
    }
    await rebuildItem(item.id);
    refreshInspector();
  });

  dom.inspectorContent.querySelector("#handle-select").addEventListener("change", async (event) => {
    item.handleAssetId = event.target.value || null;
    await rebuildItem(item.id);
  });

  for (const select of dom.inspectorContent.querySelectorAll("[data-appliance-interface]")) {
    select.addEventListener("change", async () => {
      const interfaceId = select.dataset.applianceInterface;
      item.applianceAssetIds = (item.applianceAssetIds ?? [])
        .filter((id) => APPLIANCE_ASSETS[id]?.interfaceId !== interfaceId);
      if (select.value) item.applianceAssetIds.push(select.value);
      normalizeItemAppliances(item);
      await rebuildItem(item.id);
      rebuildWorktop();
    });
  }

}

function applyCabinetDefaults(item) {
  item.frontOpen = false;
  item.frontAssetId = defaultFrontForCabinet(item.cabinetAssetId);
  item.handleAssetId = item.frontAssetId ? defaultHandleForFront(item.frontAssetId) : null;
  item.applianceAssetIds = [];
  normalizeItemAppliances(item);
}

function findAvailableCabinetPosition(item) {
  const asset = CABINET_ASSETS[item.cabinetAssetId];
  const roomBounds = new THREE.Box2().setFromPoints(
    sceneState.room.outline.map(([x, y]) => new THREE.Vector2(x, y)),
  );
  const floorElevation = sceneState.room.floorElevation;
  const [width, depth, height] = asset.dimensions;
  let z = floorElevation + 0.08;
  if (asset.family === "wall") z = Math.min(floorElevation + 1.42, floorElevation + sceneState.room.height - height);
  if (asset.family === "top") z = floorElevation + sceneState.room.height - height - 0.08;

  for (let y = roomBounds.min.y + depth / 2; y <= roomBounds.max.y - depth / 2 + COLLISION_EPSILON; y += 0.05) {
    for (let x = roomBounds.min.x + width / 2; x <= roomBounds.max.x - width / 2 + COLLISION_EPSILON; x += 0.05) {
      const position = [roundNumber(x), roundNumber(y), roundNumber(z)];
      if (validateCabinetTransform(item, position, 0).valid) return position;
    }
  }
  return null;
}

async function addCabinet(assetId) {
  const asset = CABINET_ASSETS[assetId];
  const item = {
    id: `cab_${Date.now().toString(36)}`,
    name: asset.label,
    cabinetAssetId: assetId,
    position: [0, 0, 0],
    rotationZ: 0,
    frontOpen: false,
    frontAssetId: null,
    handleAssetId: null,
    applianceAssetIds: [],
  };
  const availablePosition = findAvailableCabinetPosition(item);
  if (!availablePosition) {
    showToast("当前房间中没有可用的放置位置", true);
    return;
  }
  item.position = availablePosition;
  applyCabinetDefaults(item);
  sceneState.objects.push(item);
  await rebuildItem(item.id);
  rebuildWorktop();
  setSelected(item.id);
  showToast(`已添加：${asset.label}`);
}

function standaloneCatalog(kind) {
  return kind === "appliance" ? APPLIANCE_ASSETS : FURNITURE_ASSETS;
}

function findAvailableStandalonePosition(item, asset) {
  const roomBounds = new THREE.Box2().setFromPoints(
    sceneState.room.outline.map(([x, y]) => new THREE.Vector2(x, y)),
  );
  const [width, depth, height] = asset.bodySize;
  const bottom = sceneState.room.floorElevation + (asset.placement?.default_bottom_elevation ?? 0);
  for (let y = roomBounds.min.y + depth / 2; y <= roomBounds.max.y - depth / 2 + COLLISION_EPSILON; y += 0.05) {
    for (let x = roomBounds.min.x + width / 2; x <= roomBounds.max.x - width / 2 + COLLISION_EPSILON; x += 0.05) {
      const position = [roundNumber(x), roundNumber(y), roundNumber(Math.min(bottom, sceneState.room.floorElevation + sceneState.room.height - height))];
      if (validateCabinetTransform(item, position, 0).valid) return position;
    }
  }
  return null;
}

async function addStandaloneAsset(kind, assetId) {
  const asset = standaloneCatalog(kind)[assetId];
  if (!asset?.placement) return showToast("该资产不能作为独立组件添加", true);
  const item = {
    id: `obj_${Date.now().toString(36)}`,
    name: asset.label,
    assetKind: kind,
    assetId,
    position: [0, 0, 0],
    rotationZ: 0,
  };
  const availablePosition = findAvailableStandalonePosition(item, asset);
  if (!availablePosition) return showToast("当前房间中没有可用的放置位置", true);
  item.position = availablePosition;
  sceneState.objects.push(item);
  await rebuildItem(item.id);
  setSelected(item.id);
  showToast(`已添加：${asset.label}`);
}

function deleteSelected() {
  if (!selectedId) return;
  const index = sceneState.objects.findIndex((item) => item.id === selectedId);
  if (index === -1) return;
  const [removed] = sceneState.objects.splice(index, 1);
  const root = objectMap.get(removed.id);
  if (root) sceneRoot.remove(root);
  objectMap.delete(removed.id);
  setSelected(null);
  rebuildWorktop();
  refreshSceneTree();
  showToast(`已删除：${removed.name}`);
}

function focusSelected() {
  if (!selectedId) return;
  const root = objectMap.get(selectedId);
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const distance = Math.max(size.x, size.y, size.z) * 2.8 + 0.6;
  const direction = camera.position.clone().sub(orbitControls.target).normalize();
  orbitControls.target.copy(center);
  camera.position.copy(center).add(direction.multiplyScalar(distance));
  orbitControls.update();
}

function saveSceneJson() {
  syncSceneTransforms();
  const blob = new Blob([JSON.stringify(sceneState, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "kitchen_demo_scene.json";
  anchor.click();
  URL.revokeObjectURL(url);
  showToast("场景 JSON 已保存");
}

function exportCurrentDrawings() {
  try {
    syncSceneTransforms();
    const result = exportKitchenDrawings(sceneState);
    const elevations = result.elevationWallCount
      ? `，以及 ${result.elevationWallCount} 张吊柜墙面立面图`
      : "";
    showToast(`已导出 ${result.pageCount} 页图纸：俯视图${elevations}`);
  } catch (error) {
    showToast(`图纸导出失败：${error.message}`, true);
  }
}

function syncSceneTransforms() {
  for (const item of sceneState.objects) {
    const root = objectMap.get(item.id);
    if (!root) continue;
    item.position = root.position.toArray().map(roundNumber);
    item.rotationZ = roundNumber(root.rotation.z);
  }
}

async function checkRefinementService() {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    dom.aiStatusDot.classList.toggle("online", response.ok);
    dom.aiStatusDot.title = response.ok ? "本地生成服务已连接" : "本地生成服务未连接";
  } catch {
    dom.aiStatusDot.classList.remove("online");
    dom.aiStatusDot.title = "本地生成服务未连接；请使用 npm run studio 启动";
  }
}

async function submitAiRefinement(event) {
  event.preventDefault();
  const instruction = dom.aiRefineInput.value.trim();
  if (!instruction) return;
  if (refinementOriginalState) {
    showToast("请先接受或撤销当前候选方案", true);
    return;
  }

  syncSceneTransforms();
  appendAiMessage("user", instruction);
  dom.aiRefineInput.value = "";
  setAiBusy(true, "正在创建修改任务…");
  try {
    const response = await fetch("/api/refinements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scene: sceneState,
        instruction,
        conversationKey: editorConversationKey,
        planName: sceneState.name || generatedPlanId || "厨房方案",
      }),
    });
    const task = await response.json();
    if (!response.ok) throw new Error(task.error || "无法创建修改任务");
    appendAiMessage("assistant", "已开始修改。我会核验布局、渲染两张视图并检查结果。", "progress");
    followRefinementTask(task.id);
  } catch (error) {
    setAiBusy(false);
    appendAiMessage("assistant", `修改失败：${error.message}`, "error");
  }
}

function followRefinementTask(sessionId) {
  refinementEventSource?.close();
  refinementEventSource = new EventSource(`/api/refinements/${encodeURIComponent(sessionId)}/events`);
  refinementEventSource.addEventListener("snapshot", async (event) => {
    const snapshot = JSON.parse(event.data);
    if (snapshot.status !== "completed") return;
    refinementEventSource.close();
    try {
      await previewRefinement(sessionId);
    } catch (error) {
      setAiBusy(false);
      appendAiMessage("assistant", `读取候选方案失败：${error.message}`, "error");
    }
  });
  refinementEventSource.addEventListener("progress", (event) => {
    const detail = JSON.parse(event.data);
    updateLatestAiProgress(detail.message);
  });
  refinementEventSource.addEventListener("status", (event) => {
    const detail = JSON.parse(event.data);
    updateLatestAiProgress(detail.message);
  });
  refinementEventSource.addEventListener("completed", async () => {
    refinementEventSource.close();
    try {
      await previewRefinement(sessionId);
    } catch (error) {
      setAiBusy(false);
      appendAiMessage("assistant", `读取候选方案失败：${error.message}`, "error");
    }
  });
  refinementEventSource.addEventListener("failed", (event) => {
    refinementEventSource.close();
    setAiBusy(false);
    const detail = JSON.parse(event.data);
    appendAiMessage("assistant", `修改失败：${detail.message}`, "error");
  });
}

async function previewRefinement(sessionId) {
  const resultResponse = await fetch(`/api/refinements/${encodeURIComponent(sessionId)}`, { cache: "no-store" });
  const result = await resultResponse.json();
  if (!resultResponse.ok || !result.candidateUrl) throw new Error(result.error || "缺少候选场景文件");
  const sceneResponse = await fetch(result.candidateUrl, { cache: "no-store" });
  if (!sceneResponse.ok) throw new Error(`候选场景读取失败：HTTP ${sceneResponse.status}`);
  const candidate = migrateLegacyBuiltInFronts(migrateLegacyWorktop(await sceneResponse.json()));
  validateSceneState(candidate);

  refinementOriginalState = structuredClone(sceneState);
  sceneState = candidate;
  selectedId = null;
  await rebuildEntireScene();
  setAiBusy(false);
  dom.aiPreviewActions.hidden = false;
  const changes = Array.isArray(result.summary?.changes) ? result.summary.changes : [];
  const score = result.evaluation?.overallScore;
  const message = [
    changes.length ? `已完成：${changes.join("；")}` : "候选方案已完成并载入预览。",
    Number.isFinite(score) ? `功能性评价 ${score} 分。` : "",
  ].filter(Boolean).join(" ");
  appendAiMessage("assistant", message);
  showToast("AI 候选方案已载入，可接受或撤销");
}

async function discardAiRefinement() {
  if (!refinementOriginalState) return;
  sceneState = refinementOriginalState;
  refinementOriginalState = null;
  selectedId = null;
  dom.aiPreviewActions.hidden = true;
  await rebuildEntireScene();
  appendAiMessage("assistant", "已撤销候选方案，恢复修改前的场景。");
}

function acceptAiRefinement() {
  if (!refinementOriginalState) return;
  refinementOriginalState = null;
  dom.aiPreviewActions.hidden = true;
  appendAiMessage("assistant", "已接受修改。你可以继续手动编辑或提出下一项调整。");
  showToast("已接受 AI 修改");
}

function setAiBusy(busy, message = "") {
  dom.aiRefineSubmit.disabled = busy;
  dom.aiRefineInput.disabled = busy;
  dom.aiRefineSubmit.textContent = busy ? "生成中…" : "生成修改";
  if (busy && message) updateLatestAiProgress(message);
}

function appendAiMessage(role, text, state = "") {
  const message = document.createElement("div");
  message.className = `ai-message ${role}${state ? ` ${state}` : ""}`;
  message.textContent = text;
  dom.aiConversation.append(message);
  dom.aiConversation.scrollTop = dom.aiConversation.scrollHeight;
  return message;
}

function updateLatestAiProgress(text) {
  const latest = dom.aiConversation.querySelector(".ai-message.progress:last-child");
  if (latest) latest.textContent = text;
  else appendAiMessage("assistant", text, "progress");
}

async function loadSceneJson(event) {
  const [file] = event.target.files;
  event.target.value = "";
  if (!file) return;
  try {
    const parsed = migrateLegacyBuiltInFronts(migrateLegacyWorktop(JSON.parse(await file.text())));
    validateSceneState(parsed);
    sceneState = parsed;
    await rebuildEntireScene();
    showToast("场景 JSON 已载入");
  } catch (error) {
    showToast(`载入失败：${error.message}`, true);
  }
}

function migrateLegacyBuiltInFronts(value) {
  const styleCounts = new Map();
  for (const item of value.objects ?? []) {
    const styleId = item.frontAssetId?.split("__")[0];
    if (styleId) styleCounts.set(styleId, (styleCounts.get(styleId) ?? 0) + 1);
  }
  const preferredStyleId = [...styleCounts.entries()]
    .sort((left, right) => right[1] - left[1])[0]?.[0] ?? "FRONT_FLAT_MATTE_WHITE";

  for (const item of value.objects ?? []) {
    const cabinet = CABINET_ASSETS[item.cabinetAssetId];
    if (item.frontAssetId || !cabinet?.defaultFrontLayoutId) continue;
    const styledFrontId = `${preferredStyleId}__${cabinet.defaultFrontLayoutId}`;
    const defaultFrontId = FRONT_ASSETS[styledFrontId] ? styledFrontId : defaultFrontForCabinet(item.cabinetAssetId);
    if (!defaultFrontId || FRONT_ASSETS[defaultFrontId]?.layoutKind !== "mixed") continue;
    item.frontAssetId = defaultFrontId;
    item.handleAssetId = defaultHandleForFront(defaultFrontId);
  }
  return value;
}

function migrateLegacyWorktop(value) {
  const worktop = value?.worktop;
  if (!worktop || Array.isArray(worktop.regions)) return value;
  if (!Array.isArray(worktop.position) || !Number.isFinite(worktop.length) || !Number.isFinite(worktop.depth)) {
    return value;
  }
  const [originX, originY, elevation = 0.88] = worktop.position;
  const rotation = worktop.rotationZ ?? 0;
  const origin = new THREE.Vector2(originX, originY);
  const outline = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(worktop.length, 0),
    new THREE.Vector2(worktop.length, worktop.depth),
    new THREE.Vector2(0, worktop.depth),
  ].map((point) => point.rotateAround(new THREE.Vector2(), rotation).add(origin).toArray());
  value.schemaVersion = "1.3.0";
  value.worktop = {
    assetId: worktop.assetId,
    elevation,
    regions: [{ id: "worktop_main", outline }],
  };
  return value;
}

async function resetScene() {
  try {
    sceneState = cloneDemoScene();
    await rebuildEntireScene();
    showToast("已恢复演示场景");
  } catch (error) {
    loadingCount = 0;
    updateLoadingOverlay();
    showToast(`重置失败：${error.message}`, true);
  }
}

function validateSceneState(value) {
  if (!value || !Array.isArray(value.objects)) throw new Error("缺少 objects 数组");
  if (value.schemaVersion !== "1.3.0") throw new Error("场景 schemaVersion 必须是 1.3.0");
  if (!value.room || value.room.shape !== "polygon") throw new Error("缺少 polygon room 定义");
  if (!Array.isArray(value.room.outline) || value.room.outline.length < 4) {
    throw new Error("room.outline 至少需要四个顶点");
  }
  if (!Number.isFinite(value.room.floorElevation)) throw new Error("room.floorElevation 无效");
  if (!Number.isFinite(value.room.height) || value.room.height <= 0) throw new Error("room.height 无效");
  if (!Number.isFinite(value.room.wallThickness) || value.room.wallThickness < 0) {
    throw new Error("room.wallThickness 无效");
  }
  const roomOutline = value.room.outline.map((point, index) => {
    if (!Array.isArray(point) || point.length !== 2 || point.some((coordinate) => !Number.isFinite(coordinate))) {
      throw new Error(`room.outline 顶点 ${index + 1} 无效`);
    }
    return new THREE.Vector2(point[0], point[1]);
  });
  for (let index = 0; index < roomOutline.length; index += 1) {
    const start = roomOutline[index];
    const end = roomOutline[(index + 1) % roomOutline.length];
    const deltaX = Math.abs(end.x - start.x);
    const deltaY = Math.abs(end.y - start.y);
    if (deltaX <= 1e-7 && deltaY <= 1e-7) throw new Error(`room.outline 边 ${index + 1} 长度为零`);
    if (deltaX > 1e-7 && deltaY > 1e-7) throw new Error(`room.outline 边 ${index + 1} 不是水平或垂直墙段`);
  }
  if (polygonHasSelfIntersections(roomOutline)) throw new Error("room.outline 存在自交或重复接触");
  if (polygonSignedArea(roomOutline) <= 1e-6) throw new Error("room.outline 必须按逆时针顺序给出");
  validateRoomOpenings(value.room, roomOutline);

  if (!value.worktop || !WORKTOP_ASSETS[value.worktop.assetId]) throw new Error("worktop 资产无效");
  if (!Number.isFinite(value.worktop.elevation)) throw new Error("worktop.elevation 无效");
  if (!Array.isArray(value.worktop.regions) || value.worktop.regions.length === 0) {
    throw new Error("worktop.regions 至少需要一个区域");
  }
  const regionIds = new Set();
  for (const region of value.worktop.regions) {
    if (!region.id || regionIds.has(region.id)) throw new Error("worktop region id 缺失或重复");
    regionIds.add(region.id);
    if (!Array.isArray(region.outline) || region.outline.length < 3) {
      throw new Error(`worktop 区域 ${region.id} 至少需要三个轮廓点`);
    }
    const regionOutline = region.outline.map((point) => {
      if (!Array.isArray(point) || point.length !== 2 || point.some((value) => !Number.isFinite(value))) {
        throw new Error(`worktop 区域 ${region.id} 的轮廓点无效`);
      }
      return new THREE.Vector2(point[0], point[1]);
    });
    if (polygonHasSelfIntersections(regionOutline)) throw new Error(`worktop 区域 ${region.id} 存在自交`);
    if (polygonSignedArea(regionOutline) <= 1e-6) {
      throw new Error(`worktop 区域 ${region.id} 必须按逆时针顺序给出`);
    }
    if (!polygonContainedInPolygon(regionOutline, roomOutline)) {
      throw new Error(`worktop 区域 ${region.id} 超出房间边界`);
    }
  }
  for (const item of value.objects) {
    const isCabinet = Boolean(CABINET_ASSETS[item.cabinetAssetId]);
    const standaloneAsset = standaloneAssetForItem(item);
    if (!item.id || (!isCabinet && !standaloneAsset)) throw new Error(`场景对象无效：${item.id ?? "unknown"}`);
    if (!Array.isArray(item.position) || item.position.length !== 3 || item.position.some((coordinate) => !Number.isFinite(coordinate))) {
      throw new Error(`位置格式无效：${item.id}`);
    }
    if (!Number.isFinite(item.rotationZ)) throw new Error(`rotationZ 格式无效：${item.id}`);
    if (!envelopeFitsRoom(createCabinetEnvelope(item), value.room)) {
      throw new Error(`对象超出房间边界：${item.id}`);
    }
    for (const opening of value.room.openings) {
      const openingEnvelope = openingCollisionEnvelope(value.room, opening);
      if (openingEnvelope && cabinetEnvelopesOverlap(createCabinetEnvelope(item), openingEnvelope)) {
        throw new Error(`对象 ${item.id} 遮挡${opening.type === "door" ? "门" : "窗"} ${opening.id}`);
      }
    }
    if (isCabinet && item.frontOpen !== undefined && typeof item.frontOpen !== "boolean") {
      throw new Error(`frontOpen 格式无效：${item.id}`);
    }
  }

  const worktopAsset = WORKTOP_ASSETS[value.worktop.assetId];
  const worktopMinZ = value.worktop.elevation;
  const worktopMaxZ = worktopMinZ + worktopAsset.thickness;
  for (const region of value.worktop.regions) {
    const regionOutline = region.outline.map(([x, y]) => new THREE.Vector2(x, y));
    for (const opening of value.room.openings) {
      const envelope = openingCollisionEnvelope(value.room, opening);
      if (!envelope || worktopMaxZ <= envelope.minZ || envelope.maxZ <= worktopMinZ) continue;
      if (polygonsOverlap(regionOutline, envelopeFootprint(envelope))) {
        throw new Error(`台面区域 ${region.id} 遮挡${opening.type === "door" ? "门" : "窗"} ${opening.id}`);
      }
    }
  }
}

function validateRoomOpenings(room, roomOutline) {
  if (!Array.isArray(room.openings)) throw new Error("room.openings 必须是数组");
  const ids = new Set();
  const resolved = [];
  for (const opening of room.openings) {
    if (!opening?.id || ids.has(opening.id)) throw new Error("门窗 id 缺失或重复");
    ids.add(opening.id);
    if (!["door", "window"].includes(opening.type)) throw new Error(`门窗类型无效：${opening.id}`);
    if (!Number.isInteger(opening.wallIndex) || opening.wallIndex < 0 || opening.wallIndex >= room.outline.length) {
      throw new Error(`门窗 wallIndex 无效：${opening.id}`);
    }
    for (const key of ["centerOffset", "width", "bottomOffset", "height"]) {
      if (!Number.isFinite(opening[key]) || opening[key] < 0 || (["centerOffset", "width", "height"].includes(key) && opening[key] <= 0)) {
        throw new Error(`门窗 ${opening.id} 的 ${key} 无效`);
      }
    }
    if (opening.type === "door") {
      if (opening.bottomOffset !== 0) throw new Error(`门 ${opening.id} 的 bottomOffset 必须为 0`);
      if (!["swing", "sliding", "opening"].includes(opening.operation)) throw new Error(`门 ${opening.id} 的 operation 无效`);
      if (!["start", "end", "none"].includes(opening.hingeSide)) throw new Error(`门 ${opening.id} 的 hingeSide 无效`);
      if (!["inward", "outward", "none"].includes(opening.opensToward)) throw new Error(`门 ${opening.id} 的 opensToward 无效`);
      if (opening.operation === "swing" && (!["start", "end"].includes(opening.hingeSide) || !["inward", "outward"].includes(opening.opensToward))) {
        throw new Error(`平开门 ${opening.id} 必须指定有效的合页侧和开启方向`);
      }
      if (opening.operation !== "swing" && (opening.hingeSide !== "none" || opening.opensToward !== "none")) {
        throw new Error(`非平开门 ${opening.id} 的 hingeSide 和 opensToward 必须为 none`);
      }
    }
    if (opening.type === "window" && opening.bottomOffset <= 0) throw new Error(`窗 ${opening.id} 的 bottomOffset 必须大于 0`);
    const geometry = resolveRoomOpening(room, opening);
    if (!geometry || opening.centerOffset - opening.width / 2 < -COLLISION_EPSILON
      || opening.centerOffset + opening.width / 2 > geometry.wallLength + COLLISION_EPSILON) {
      throw new Error(`门窗 ${opening.id} 超出所在墙段`);
    }
    if (geometry.maxZ > room.floorElevation + room.height + COLLISION_EPSILON) {
      throw new Error(`门窗 ${opening.id} 超出房间高度`);
    }
    const clearance = openingCollisionEnvelope(room, opening);
    if (clearance && !polygonContainedInPolygon(envelopeFootprint(clearance), roomOutline)) {
      throw new Error(`门窗 ${opening.id} 的室内净空超出房间边界`);
    }
    resolved.push({ opening, geometry });
  }
  for (let left = 0; left < resolved.length; left += 1) {
    for (let right = left + 1; right < resolved.length; right += 1) {
      const a = resolved[left];
      const b = resolved[right];
      if (a.opening.wallIndex !== b.opening.wallIndex) continue;
      const aClearance = a.opening.type === "door" ? OPENING_DEFAULTS.doorSideClearance : 0.01;
      const bClearance = b.opening.type === "door" ? OPENING_DEFAULTS.doorSideClearance : 0.01;
      const horizontalOverlap = Math.abs(a.opening.centerOffset - b.opening.centerOffset)
        < (a.opening.width + b.opening.width) / 2 + aClearance + bClearance - COLLISION_EPSILON;
      const verticalOverlap = a.geometry.minZ < b.geometry.maxZ - COLLISION_EPSILON
        && b.geometry.minZ < a.geometry.maxZ - COLLISION_EPSILON;
      if (horizontalOverlap && verticalOverlap) throw new Error(`门窗 ${a.opening.id} 与 ${b.opening.id} 重叠`);
    }
  }
}

function polygonsOverlap(left, right) {
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const leftNext = (leftIndex + 1) % left.length;
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const rightNext = (rightIndex + 1) % right.length;
      if (segmentsIntersectOrTouch(left[leftIndex], left[leftNext], right[rightIndex], right[rightNext])) return true;
    }
  }
  return pointInsideOrOnPolygon(left[0], right) || pointInsideOrOnPolygon(right[0], left);
}

function onKeyDown(event) {
  if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
  if (event.key.toLowerCase() === "q") setTool("select");
  if (event.key.toLowerCase() === "w") setTool("translate");
  if (event.key.toLowerCase() === "e") setTool("rotate");
  if (event.key.toLowerCase() === "o") toggleSelectedFront();
  if (event.key.toLowerCase() === "f") focusSelected();
  if (event.key === "Delete" || event.key === "Backspace") deleteSelected();
}

function findSceneItem(id) {
  return sceneState.objects.find((item) => item.id === id);
}

function optionsHtml(registry, selectedValue) {
  return Object.values(registry)
    .map((item) => `<option value="${item.id}" ${item.id === selectedValue ? "selected" : ""}>${item.label}</option>`)
    .join("");
}

function isHandleCompatibleWithFront(handleAssetId, frontAssetId) {
  const handle = HANDLE_ASSETS[handleAssetId];
  const front = FRONT_ASSETS[frontAssetId];
  if (!handle || !front) return false;
  if (!handle.allowedFrontKinds) return true;
  if (handle.allowedFrontKinds.includes(front.layoutKind)) return true;
  if (front.layoutKind === "mixed" && handle.allowedFrontKinds.includes("door")) return true;
  return front.layoutId === "DOOR_HORIZONTAL" && handle.allowedFrontKinds.includes("horizontal_door");
}

function defaultHandleForFront(frontAssetId) {
  const preferredId = "HANDLE_BAR_160_BLACK";
  if (isHandleCompatibleWithFront(preferredId, frontAssetId)) return preferredId;
  return Object.values(HANDLE_ASSETS).find((handle) => isHandleCompatibleWithFront(handle.id, frontAssetId))?.id ?? null;
}

function handleOptionsHtml(frontAssetId, selectedValue) {
  return Object.values(HANDLE_ASSETS)
    .filter((handle) => isHandleCompatibleWithFront(handle.id, frontAssetId))
    .map((handle) => `<option value="${handle.id}" ${handle.id === selectedValue ? "selected" : ""}>${handle.label}</option>`)
    .join("");
}

function numberField(label, key, value, step, className = "") {
  return `
    <label class="number-field ${className}">
      <span>${label}</span>
      <input type="number" step="${step}" value="${Number(value).toFixed(key === "yaw" ? 1 : 3)}" data-transform="${key}" />
    </label>
  `;
}

function formatDimensions(dimensions) {
  return dimensions.map((value) => `${Math.round(value * 1000)}`).join(" × ") + " mm";
}

function roundNumber(value) {
  return Number(value.toFixed(5));
}

function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  dom.toast.textContent = message;
  dom.toast.classList.toggle("error", isError);
  dom.toast.classList.add("visible");
  toastTimer = setTimeout(() => dom.toast.classList.remove("visible"), 2800);
}
