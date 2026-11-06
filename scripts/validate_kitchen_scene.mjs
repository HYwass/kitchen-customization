import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ADJACENCY_TOLERANCE = 0.01;
const WALL_ATTACHMENT_TOLERANCE = 0.03;
const GEOMETRY_EPSILON = 1e-7;
const OPENING_DEFAULTS = {
  doorSideClearance: 0.05,
  doorPassageDepth: 0.6,
  windowClearanceDepth: 0.15,
  windowVerticalClearance: 0.05,
};
const TARGETS = {
  compactnessScore: 92,
  floorRunContinuity: 0.98,
  floorWallUtilization: 0.85,
  largestInternalGap: ADJACENCY_TOLERANCE,
};

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1]];
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1]];
}

function scale(vector, amount) {
  return [vector[0] * amount, vector[1] * amount];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1];
}

function cross(a, b) {
  return a[0] * b[1] - a[1] * b[0];
}

function length(vector) {
  return Math.hypot(vector[0], vector[1]);
}

function pointOnSegment(point, start, end, epsilon = GEOMETRY_EPSILON) {
  const edge = subtract(end, start);
  const offset = subtract(point, start);
  if (Math.abs(cross(edge, offset)) > epsilon) return false;
  const projection = dot(offset, edge);
  return projection >= -epsilon && projection <= dot(edge, edge) + epsilon;
}

function pointInsidePolygon(point, polygon) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const a = polygon[previous];
    const b = polygon[current];
    if (pointOnSegment(point, a, b)) return false;
    if (
      (a[1] > point[1]) !== (b[1] > point[1])
      && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    ) inside = !inside;
  }
  return inside;
}

function pointInsideOrOnPolygon(point, polygon) {
  return polygon.some((start, index) => pointOnSegment(point, start, polygon[(index + 1) % polygon.length]))
    || pointInsidePolygon(point, polygon);
}

function segmentInsidePolygon(start, end, polygon) {
  const direction = subtract(end, start);
  const lengthSquared = dot(direction, direction);
  if (lengthSquared <= GEOMETRY_EPSILON ** 2) return pointInsideOrOnPolygon(start, polygon);

  const parameters = [0, 1];
  for (let index = 0; index < polygon.length; index += 1) {
    const edgeStart = polygon[index];
    const edgeEnd = polygon[(index + 1) % polygon.length];
    const edgeDirection = subtract(edgeEnd, edgeStart);
    const offset = subtract(edgeStart, start);
    const denominator = cross(direction, edgeDirection);

    if (Math.abs(denominator) <= GEOMETRY_EPSILON) {
      if (Math.abs(cross(offset, direction)) > GEOMETRY_EPSILON) continue;
      for (const point of [edgeStart, edgeEnd]) {
        const t = dot(subtract(point, start), direction) / lengthSquared;
        if (t > 0 && t < 1) parameters.push(t);
      }
      continue;
    }

    const t = cross(offset, edgeDirection) / denominator;
    const u = cross(offset, direction) / denominator;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) parameters.push(t);
  }

  parameters.sort((left, right) => left - right);
  const unique = parameters.filter((value, index) => index === 0 || Math.abs(value - parameters[index - 1]) > GEOMETRY_EPSILON);
  for (let index = 0; index < unique.length - 1; index += 1) {
    const t = (unique[index] + unique[index + 1]) / 2;
    if (!pointInsideOrOnPolygon(add(start, scale(direction, t)), polygon)) return false;
  }
  return true;
}

function polygonContainedInPolygon(candidate, container) {
  return candidate.every((point) => pointInsideOrOnPolygon(point, container))
    && candidate.every((point, index) => segmentInsidePolygon(point, candidate[(index + 1) % candidate.length], container));
}

function polygonArea(points) {
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2;
}

function segmentsIntersectOrTouch(a, b, c, d) {
  const abC = cross(subtract(b, a), subtract(c, a));
  const abD = cross(subtract(b, a), subtract(d, a));
  const cdA = cross(subtract(d, c), subtract(a, c));
  const cdB = cross(subtract(d, c), subtract(b, c));
  if (
    ((abC > GEOMETRY_EPSILON && abD < -GEOMETRY_EPSILON) || (abC < -GEOMETRY_EPSILON && abD > GEOMETRY_EPSILON))
    && ((cdA > GEOMETRY_EPSILON && cdB < -GEOMETRY_EPSILON) || (cdA < -GEOMETRY_EPSILON && cdB > GEOMETRY_EPSILON))
  ) return true;
  if (Math.abs(abC) <= GEOMETRY_EPSILON && pointOnSegment(c, a, b)) return true;
  if (Math.abs(abD) <= GEOMETRY_EPSILON && pointOnSegment(d, a, b)) return true;
  if (Math.abs(cdA) <= GEOMETRY_EPSILON && pointOnSegment(a, c, d)) return true;
  return Math.abs(cdB) <= GEOMETRY_EPSILON && pointOnSegment(b, c, d);
}

function polygonHasSelfIntersections(points) {
  for (let left = 0; left < points.length; left += 1) {
    const leftNext = (left + 1) % points.length;
    for (let right = left + 1; right < points.length; right += 1) {
      const rightNext = (right + 1) % points.length;
      if (leftNext === right || rightNext === left) continue;
      if (segmentsIntersectOrTouch(points[left], points[leftNext], points[right], points[rightNext])) return true;
    }
  }
  return false;
}

function buildCatalogs() {
  const cabinetsCatalog = readJson(path.join(projectRoot, "catalog", "cabinets.json"));
  const frontsCatalog = readJson(path.join(projectRoot, "catalog", "front_styles.json"));
  const handlesCatalog = readJson(path.join(projectRoot, "catalog", "handles.json"));
  const appliancesCatalog = readJson(path.join(projectRoot, "catalog", "appliances.json"));
  const furnitureCatalog = readJson(path.join(projectRoot, "catalog", "furniture.json"));
  const worktopsCatalog = readJson(path.join(projectRoot, "catalog", "worktops.json"));
  const cabinetAssets = new Map();

  function applianceSlots(profile, configurationDefinition) {
    if (configurationDefinition?.appliance_slots) {
      return configurationDefinition.appliance_slots.map((slot) => ({
        id: slot.id,
        interfaceId: slot.interface_id,
      }));
    }
    if (configurationDefinition?.interface_id) {
      return [
        { id: "primary", interfaceId: configurationDefinition.interface_id },
        ...(configurationDefinition.secondary_interface_ids ?? []).map((interfaceId, index) => ({
          id: `secondary_${index + 1}`,
          interfaceId,
        })),
      ];
    }
    if (profile.appliance?.interface_id) {
      return [{ id: "primary", interfaceId: profile.appliance.interface_id }];
    }
    return [];
  }

  for (const definition of cabinetsCatalog.cabinet_models) {
    const profile = cabinetsCatalog.slot_profiles[definition.slot_profile_id];
    const configurations = Object.keys(profile.configurations ?? {});
    const variants = configurations.length > 0 ? configurations : [null];
    for (const configuration of variants) {
      const id = configuration ? `${definition.id}__${configuration}` : definition.id;
      const configurationDefinition = configuration ? profile.configurations[configuration] : null;
      cabinetAssets.set(id, {
        id,
        family: definition.family,
        dimensions: definition.dimensions,
        cornerGeometry: definition.corner_geometry ?? null,
        applianceSlots: applianceSlots(profile, configurationDefinition),
      });
    }
  }

  const frontIds = new Set(frontsCatalog.styles.flatMap((style) => (
    frontsCatalog.layout_presets.map((layout) => `${style.id}__${layout.id}`)
  )));
  const applianceAssets = new Map(appliancesCatalog.appliances.map((item) => [item.id, item]));
  const worktopAssets = new Map(worktopsCatalog.styles.map((item) => [item.id, item]));
  const standaloneAssets = new Map([
    ...appliancesCatalog.appliances
      .filter((item) => item.placement)
      .map((item) => [item.id, { ...item, assetKind: "appliance", dimensions: item.body_size, family: null, cornerGeometry: null }]),
    ...furnitureCatalog.furniture
      .map((item) => [item.id, { ...item, assetKind: "furniture", dimensions: item.body_size, family: null, cornerGeometry: null }]),
  ]);
  return {
    cabinetAssets,
    frontIds,
    handleIds: new Set(handlesCatalog.handles.map((item) => item.id)),
    applianceAssets,
    standaloneAssets,
    worktopIds: new Set(worktopAssets.keys()),
    worktopAssets,
  };
}

function validateRoom(room, hardErrors) {
  if (!room || room.shape !== "polygon") {
    hardErrors.push("room.shape must be polygon");
    return null;
  }
  if (!Array.isArray(room.outline) || room.outline.length < 4) {
    hardErrors.push("room.outline must contain at least four points");
    return null;
  }
  const outline = room.outline.map((point) => Array.isArray(point) ? [Number(point[0]), Number(point[1])] : [NaN, NaN]);
  if (outline.some((point) => point.length !== 2 || point.some((value) => !Number.isFinite(value)))) {
    hardErrors.push("room.outline contains an invalid point");
    return null;
  }
  for (let index = 0; index < outline.length; index += 1) {
    const edge = subtract(outline[(index + 1) % outline.length], outline[index]);
    if (length(edge) <= GEOMETRY_EPSILON) hardErrors.push(`room edge ${index + 1} has zero length`);
    if (Math.abs(edge[0]) > GEOMETRY_EPSILON && Math.abs(edge[1]) > GEOMETRY_EPSILON) {
      hardErrors.push(`room edge ${index + 1} is not orthogonal`);
    }
  }
  if (polygonHasSelfIntersections(outline)) hardErrors.push("room.outline self-intersects or touches itself");
  if (polygonArea(outline) <= GEOMETRY_EPSILON) hardErrors.push("room.outline must be counter-clockwise");
  if (!Number.isFinite(room.floorElevation) || !Number.isFinite(room.height) || room.height <= 0) {
    hardErrors.push("room vertical dimensions are invalid");
  }
  return outline;
}

function createEnvelope(item, asset) {
  const rotation = item.rotationZ ?? 0;
  const xAxis = [Math.cos(rotation), Math.sin(rotation)];
  const yAxis = [-Math.sin(rotation), Math.cos(rotation)];
  const [width, depth, height] = asset.dimensions;
  const center = [item.position[0], item.position[1]];
  const footprint = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => add(
    center,
    add(scale(xAxis, sx * width / 2), scale(yAxis, sy * depth / 2)),
  ));
  return {
    item,
    asset,
    center,
    xAxis,
    yAxis,
    front: yAxis,
    halfWidth: width / 2,
    halfDepth: depth / 2,
    minZ: item.position[2],
    maxZ: item.position[2] + height,
    footprint,
  };
}

function projectionRadius(envelope, axis) {
  return envelope.halfWidth * Math.abs(dot(envelope.xAxis, axis))
    + envelope.halfDepth * Math.abs(dot(envelope.yAxis, axis));
}

function envelopesOverlap(a, b) {
  if (a.maxZ <= b.minZ + GEOMETRY_EPSILON || b.maxZ <= a.minZ + GEOMETRY_EPSILON) return false;
  const delta = subtract(b.center, a.center);
  for (const axis of [a.xAxis, a.yAxis, b.xAxis, b.yAxis]) {
    if (Math.abs(dot(delta, axis)) >= projectionRadius(a, axis) + projectionRadius(b, axis) - GEOMETRY_EPSILON) {
      return false;
    }
  }
  return true;
}

function buildWallSegments(outline) {
  return outline.map((start, index) => {
    const end = outline[(index + 1) % outline.length];
    const delta = subtract(end, start);
    const wallLength = length(delta);
    const direction = scale(delta, 1 / wallLength);
    return {
      id: `wall_${String(index + 1).padStart(2, "0")}`,
      index,
      start,
      end,
      length: wallLength,
      direction,
      inward: [-direction[1], direction[0]],
    };
  });
}

function resolveOpening(room, opening, walls) {
  const wall = walls[opening.wallIndex];
  if (!wall) return null;
  const center = add(wall.start, scale(wall.direction, opening.centerOffset));
  const isInwardSwing = opening.type === "door"
    && opening.operation === "swing"
    && opening.opensToward === "inward";
  const depth = opening.type === "window"
    ? OPENING_DEFAULTS.windowClearanceDepth
    : isInwardSwing ? opening.width : OPENING_DEFAULTS.doorPassageDepth;
  const sideClearance = opening.type === "door" ? OPENING_DEFAULTS.doorSideClearance : 0.01;
  const envelopeCenter = add(center, scale(wall.inward, depth / 2));
  const openingMinZ = room.floorElevation + opening.bottomOffset;
  const minZ = opening.type === "window"
    ? Math.max(room.floorElevation, openingMinZ - OPENING_DEFAULTS.windowVerticalClearance)
    : openingMinZ;
  const envelope = createEnvelope(
    {
      id: opening.id,
      position: [envelopeCenter[0], envelopeCenter[1], minZ],
      rotationZ: Math.atan2(wall.direction[1], wall.direction[0]),
    },
    {
      dimensions: [opening.width + 2 * sideClearance, depth, opening.height + openingMinZ - minZ],
      family: "opening",
      cornerGeometry: null,
    },
  );
  return {
    opening,
    wall,
    envelope,
    interval: {
      start: Math.max(0, opening.centerOffset - opening.width / 2 - sideClearance),
      end: Math.min(wall.length, opening.centerOffset + opening.width / 2 + sideClearance),
    },
  };
}

function validateOpenings(room, outline, walls, hardErrors) {
  if (!Array.isArray(room.openings)) {
    hardErrors.push("room.openings must be an array");
    return [];
  }
  const ids = new Set();
  const resolved = [];
  for (const opening of room.openings) {
    if (!opening?.id || ids.has(opening.id)) {
      hardErrors.push("room opening id is missing or duplicated");
      continue;
    }
    ids.add(opening.id);
    if (!["door", "window"].includes(opening.type)) {
      hardErrors.push(`${opening.id}: invalid opening type`);
      continue;
    }
    if (!Number.isInteger(opening.wallIndex) || opening.wallIndex < 0 || opening.wallIndex >= walls.length) {
      hardErrors.push(`${opening.id}: invalid wallIndex`);
      continue;
    }
    const numericKeys = ["centerOffset", "width", "bottomOffset", "height"];
    if (numericKeys.some((key) => !Number.isFinite(opening[key]) || opening[key] < 0)
      || opening.centerOffset <= 0 || opening.width <= 0 || opening.height <= 0) {
      hardErrors.push(`${opening.id}: invalid dimensions`);
      continue;
    }
    if (opening.type === "door") {
      if (opening.bottomOffset !== 0) hardErrors.push(`${opening.id}: door bottomOffset must be 0`);
      if (!["swing", "sliding", "opening"].includes(opening.operation)) hardErrors.push(`${opening.id}: invalid door operation`);
      if (!["start", "end", "none"].includes(opening.hingeSide)) hardErrors.push(`${opening.id}: invalid hingeSide`);
      if (!["inward", "outward", "none"].includes(opening.opensToward)) hardErrors.push(`${opening.id}: invalid opensToward`);
      if (opening.operation === "swing" && (!["start", "end"].includes(opening.hingeSide) || !["inward", "outward"].includes(opening.opensToward))) {
        hardErrors.push(`${opening.id}: swing door requires a hinge side and opening direction`);
      }
      if (opening.operation !== "swing" && (opening.hingeSide !== "none" || opening.opensToward !== "none")) {
        hardErrors.push(`${opening.id}: non-swing door requires hingeSide and opensToward to be none`);
      }
    } else if (opening.bottomOffset <= 0) {
      hardErrors.push(`${opening.id}: window bottomOffset must be greater than 0`);
    }
    const geometry = resolveOpening(room, opening, walls);
    if (!geometry) continue;
    if (opening.centerOffset - opening.width / 2 < -GEOMETRY_EPSILON
      || opening.centerOffset + opening.width / 2 > geometry.wall.length + GEOMETRY_EPSILON) {
      hardErrors.push(`${opening.id}: opening extends beyond its wall segment`);
    }
    if (geometry.envelope.maxZ > room.floorElevation + room.height + GEOMETRY_EPSILON) {
      hardErrors.push(`${opening.id}: opening exceeds room height`);
    }
    if (!polygonContainedInPolygon(geometry.envelope.footprint, outline)) {
      hardErrors.push(`${opening.id}: interior clearance crosses the room boundary`);
    }
    resolved.push(geometry);
  }
  for (let left = 0; left < resolved.length; left += 1) {
    for (let right = left + 1; right < resolved.length; right += 1) {
      const a = resolved[left];
      const b = resolved[right];
      if (a.opening.wallIndex !== b.opening.wallIndex) continue;
      const horizontalOverlap = a.interval.start < b.interval.end - GEOMETRY_EPSILON
        && b.interval.start < a.interval.end - GEOMETRY_EPSILON;
      const verticalOverlap = a.envelope.minZ < b.envelope.maxZ - GEOMETRY_EPSILON
        && b.envelope.minZ < a.envelope.maxZ - GEOMETRY_EPSILON;
      if (horizontalOverlap && verticalOverlap) hardErrors.push(`${a.opening.id} overlaps ${b.opening.id}`);
    }
  }
  return resolved;
}

function polygonsOverlap(left, right) {
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      if (segmentsIntersectOrTouch(
        left[leftIndex],
        left[(leftIndex + 1) % left.length],
        right[rightIndex],
        right[(rightIndex + 1) % right.length],
      )) return true;
    }
  }
  return pointInsideOrOnPolygon(left[0], right) || pointInsideOrOnPolygon(right[0], left);
}

function intervalOnWall(envelope, wall) {
  const projections = envelope.footprint.map((point) => dot(subtract(point, wall.start), wall.direction));
  const start = Math.max(0, Math.min(...projections));
  const end = Math.min(wall.length, Math.max(...projections));
  return end > start + GEOMETRY_EPSILON ? { start, end } : null;
}

function wallAssignments(envelope, walls) {
  const isCorner = Boolean(envelope.asset.cornerGeometry);
  const candidates = [];
  for (const wall of walls) {
    const interval = intervalOnWall(envelope, wall);
    if (!interval) continue;
    if (isCorner) {
      const minimumDistance = Math.min(...envelope.footprint.map((point) => Math.abs(dot(subtract(point, wall.start), wall.inward))));
      if (minimumDistance <= WALL_ATTACHMENT_TOLERANCE) candidates.push({ wall, interval, score: minimumDistance });
      continue;
    }
    const alignment = dot(envelope.front, wall.inward);
    if (alignment < 0.999) continue;
    const backCenter = subtract(envelope.center, scale(envelope.front, envelope.asset.dimensions[1] / 2));
    const distance = Math.abs(dot(subtract(backCenter, wall.start), wall.inward));
    if (distance <= WALL_ATTACHMENT_TOLERANCE) candidates.push({ wall, interval, score: distance + 1 - alignment });
  }
  if (isCorner) return candidates;
  candidates.sort((left, right) => left.score - right.score);
  return candidates.slice(0, 1);
}

function usableWallSegments(wall, layer, openings, worktopTop) {
  const blocked = openings
    .filter(({ opening }) => opening.wallIndex === wall.index)
    .filter((geometry) => (
      geometry.opening.type === "door"
      || layer === "wall"
      || roomOpeningBlocksFloor(geometry, worktopTop)
    ))
    .map(({ interval }) => ({ ...interval }))
    .sort((left, right) => left.start - right.start);
  const merged = [];
  for (const interval of blocked) {
    const previous = merged.at(-1);
    if (previous && interval.start <= previous.end + GEOMETRY_EPSILON) previous.end = Math.max(previous.end, interval.end);
    else merged.push(interval);
  }
  const segments = [];
  let cursor = 0;
  for (const interval of merged) {
    if (interval.start > cursor + GEOMETRY_EPSILON) segments.push({ start: cursor, end: interval.start });
    cursor = Math.max(cursor, interval.end);
  }
  if (cursor < wall.length - GEOMETRY_EPSILON) segments.push({ start: cursor, end: wall.length });
  return segments;
}

function roomOpeningBlocksFloor(geometry, worktopTop) {
  return geometry.opening.type === "window" && geometry.envelope.minZ < worktopTop;
}

function analyzeIntervals(wall, layer, intervals) {
  const sorted = [...intervals].sort((left, right) => left.start - right.start || left.end - right.end);
  const gaps = [];
  let unionLength = 0;
  let overlapLength = 0;
  let groupStart = sorted[0].start;
  let groupEnd = sorted[0].end;
  let rightOwner = sorted[0].itemId;

  for (const interval of sorted.slice(1)) {
    if (interval.start > groupEnd + GEOMETRY_EPSILON) {
      unionLength += groupEnd - groupStart;
      gaps.push({
        from: round(groupEnd),
        to: round(interval.start),
        size: round(interval.start - groupEnd),
        leftCabinetId: rightOwner,
        rightCabinetId: interval.itemId,
      });
      groupStart = interval.start;
      groupEnd = interval.end;
      rightOwner = interval.itemId;
    } else {
      overlapLength += Math.max(0, Math.min(groupEnd, interval.end) - interval.start);
      if (interval.end > groupEnd) {
        groupEnd = interval.end;
        rightOwner = interval.itemId;
      }
    }
  }
  unionLength += groupEnd - groupStart;
  const spanStart = sorted[0].start;
  const spanEnd = Math.max(...sorted.map((interval) => interval.end));
  const spanLength = spanEnd - spanStart;
  return {
    wallId: wall.id,
    layer,
    wallLength: round(wall.length),
    cabinetIds: [...new Set(sorted.map((interval) => interval.itemId))],
    occupiedLength: round(unionLength),
    spanLength: round(spanLength),
    utilization: round(unionLength / wall.length),
    continuity: round(spanLength > 0 ? unionLength / spanLength : 0),
    startGap: round(spanStart),
    endGap: round(wall.length - spanEnd),
    internalGapTotal: round(gaps.reduce((sum, gap) => sum + gap.size, 0)),
    largestInternalGap: round(Math.max(0, ...gaps.map((gap) => gap.size))),
    overlapLength: round(overlapLength),
    gaps,
  };
}

function aggregateRuns(runs) {
  const totalWallLength = runs.reduce((sum, run) => sum + run.wallLength, 0);
  const totalOccupiedLength = runs.reduce((sum, run) => sum + run.occupiedLength, 0);
  const totalSpanLength = runs.reduce((sum, run) => sum + run.spanLength, 0);
  return {
    activeWallCount: runs.length,
    activeWallLength: round(totalWallLength),
    occupiedLength: round(totalOccupiedLength),
    wallUtilization: round(totalWallLength > 0 ? totalOccupiedLength / totalWallLength : 0),
    runContinuity: round(totalSpanLength > 0 ? totalOccupiedLength / totalSpanLength : 0),
    internalGapTotal: round(runs.reduce((sum, run) => sum + run.internalGapTotal, 0)),
    largestInternalGap: round(Math.max(0, ...runs.map((run) => run.largestInternalGap))),
    endGapTotal: round(runs.reduce((sum, run) => sum + run.startGap + run.endGap, 0)),
  };
}

function validateScene(scene, catalogs) {
  const hardErrors = [];
  const recommendations = [];
  if (scene.schemaVersion !== "1.3.0") hardErrors.push("schemaVersion must be 1.3.0");
  const roomOutline = validateRoom(scene.room, hardErrors);
  const walls = roomOutline ? buildWallSegments(roomOutline) : [];
  const openings = roomOutline ? validateOpenings(scene.room, roomOutline, walls, hardErrors) : [];
  const envelopes = [];

  for (const item of scene.objects ?? []) {
    const isCabinet = Boolean(item.cabinetAssetId);
    const asset = isCabinet
      ? catalogs.cabinetAssets.get(item.cabinetAssetId)
      : catalogs.standaloneAssets.get(item.assetId);
    if (!asset) {
      hardErrors.push(`${item.id ?? "unknown"}: unknown scene asset ${item.cabinetAssetId ?? item.assetId}`);
      continue;
    }
    if (!isCabinet && item.assetKind !== asset.assetKind) {
      hardErrors.push(`${item.id}: assetKind ${item.assetKind} does not match ${item.assetId}`);
    }
    if (!Array.isArray(item.position) || item.position.length !== 3 || item.position.some((value) => !Number.isFinite(value))) {
      hardErrors.push(`${item.id}: invalid position`);
      continue;
    }
    if (!Number.isFinite(item.rotationZ)) {
      hardErrors.push(`${item.id}: invalid rotationZ`);
      continue;
    }
    if (isCabinet && item.frontAssetId && !catalogs.frontIds.has(item.frontAssetId)) {
      hardErrors.push(`${item.id}: unknown frontAssetId ${item.frontAssetId}`);
    }
    if (item.handleAssetId && !catalogs.handleIds.has(item.handleAssetId)) {
      hardErrors.push(`${item.id}: unknown handleAssetId ${item.handleAssetId}`);
    }

    const selectedAppliances = isCabinet
      ? (item.applianceAssetIds ?? []).map((id) => catalogs.applianceAssets.get(id))
      : [];
    for (let index = 0; index < selectedAppliances.length; index += 1) {
      if (!selectedAppliances[index]) hardErrors.push(`${item.id}: unknown applianceAssetId ${item.applianceAssetIds[index]}`);
    }
    for (const slot of asset.applianceSlots ?? []) {
      const count = selectedAppliances.filter((appliance) => appliance?.interface_id === slot.interfaceId).length;
      if (count !== 1) hardErrors.push(`${item.id}: slot ${slot.id} requires exactly one ${slot.interfaceId} appliance`);
    }
    for (const appliance of selectedAppliances.filter(Boolean)) {
      if (!(asset.applianceSlots ?? []).some((slot) => slot.interfaceId === appliance.interface_id)) {
        hardErrors.push(`${item.id}: appliance ${appliance.id} does not match a cabinet slot`);
      }
    }

    const envelope = createEnvelope(item, asset);
    envelopes.push(envelope);
    if (roomOutline && !polygonContainedInPolygon(envelope.footprint, roomOutline)) {
      hardErrors.push(`${item.id}: object footprint crosses the room boundary`);
    }
    const floorElevation = scene.room?.floorElevation;
    if (
      Number.isFinite(floorElevation)
      && (envelope.minZ < floorElevation - GEOMETRY_EPSILON || envelope.maxZ > floorElevation + scene.room.height + GEOMETRY_EPSILON)
    ) hardErrors.push(`${item.id}: object exceeds the room vertical bounds`);
    for (const opening of openings) {
      if (envelopesOverlap(envelope, opening.envelope)) {
        hardErrors.push(`${item.id} blocks ${opening.opening.type} ${opening.opening.id}`);
      }
    }
  }

  for (let left = 0; left < envelopes.length; left += 1) {
    for (let right = left + 1; right < envelopes.length; right += 1) {
      if (envelopesOverlap(envelopes[left], envelopes[right])) {
        hardErrors.push(`${envelopes[left].item.id} overlaps ${envelopes[right].item.id}`);
      }
    }
  }

  if (!scene.worktop || !catalogs.worktopIds.has(scene.worktop.assetId)) {
    hardErrors.push("worktop asset is missing or unknown");
  } else if (roomOutline) {
    const worktopAsset = catalogs.worktopAssets.get(scene.worktop.assetId);
    const worktopMinZ = scene.worktop.elevation;
    const worktopMaxZ = worktopMinZ + worktopAsset.thickness;
    for (const region of scene.worktop.regions ?? []) {
      if (!Array.isArray(region.outline) || region.outline.length < 3) {
        hardErrors.push(`worktop ${region.id ?? "unknown"}: invalid outline`);
        continue;
      }
      if (polygonHasSelfIntersections(region.outline) || polygonArea(region.outline) <= GEOMETRY_EPSILON) {
        hardErrors.push(`worktop ${region.id}: outline is self-intersecting or not counter-clockwise`);
      } else if (!polygonContainedInPolygon(region.outline, roomOutline)) {
        hardErrors.push(`worktop ${region.id}: outline crosses the room boundary`);
      }
      for (const opening of openings) {
        if (worktopMaxZ <= opening.envelope.minZ || opening.envelope.maxZ <= worktopMinZ) continue;
        if (polygonsOverlap(region.outline, opening.envelope.footprint)) {
          hardErrors.push(`worktop ${region.id} blocks ${opening.opening.type} ${opening.opening.id}`);
        }
      }
    }
  }

  const intervalGroups = new Map();
  const attached = new Set();
  const relevantEnvelopes = envelopes.filter((envelope) => ["base", "high", "wall"].includes(envelope.asset.family));
  const floorEnvelopes = envelopes.filter((envelope) => ["base", "high"].includes(envelope.asset.family));

  for (const envelope of relevantEnvelopes) {
    const layer = ["base", "high"].includes(envelope.asset.family) ? "floor" : "wall";
    const assignments = wallAssignments(envelope, walls);
    if (assignments.length > 0) attached.add(envelope.item.id);
    for (const { wall, interval } of assignments) {
      const key = `${layer}:${wall.id}`;
      if (!intervalGroups.has(key)) intervalGroups.set(key, { wall, layer, intervals: [] });
      intervalGroups.get(key).intervals.push({ ...interval, itemId: envelope.item.id });
    }
  }

  const worktopThickness = catalogs.worktopAssets.get(scene.worktop?.assetId)?.thickness ?? 0;
  const worktopTop = (scene.worktop?.elevation ?? 0.88) + worktopThickness;
  const runs = [...intervalGroups.values()].flatMap(({ wall, layer, intervals }) => (
    usableWallSegments(wall, layer, openings, worktopTop).flatMap((segment, segmentIndex) => {
      const clipped = intervals
        .map((interval) => ({
          ...interval,
          start: Math.max(interval.start, segment.start),
          end: Math.min(interval.end, segment.end),
        }))
        .filter((interval) => interval.end > interval.start + GEOMETRY_EPSILON)
        .map((interval) => ({ ...interval, start: interval.start - segment.start, end: interval.end - segment.start }));
      if (clipped.length === 0) return [];
      return [analyzeIntervals(
        { ...wall, id: `${wall.id}_${segmentIndex + 1}`, length: segment.end - segment.start },
        layer,
        clipped,
      )];
    })
  ));
  const floorRuns = runs.filter((run) => run.layer === "floor");
  const wallRuns = runs.filter((run) => run.layer === "wall");
  const floorSummary = aggregateRuns(floorRuns);
  const wallSummary = aggregateRuns(wallRuns);
  const attachedFloorCount = floorEnvelopes.filter((envelope) => attached.has(envelope.item.id)).length;
  const floorAttachmentRatio = floorEnvelopes.length > 0 ? attachedFloorCount / floorEnvelopes.length : 0;
  const compactnessScore = round(100 * (
    0.55 * floorSummary.runContinuity
    + 0.35 * floorSummary.wallUtilization
    + 0.10 * floorAttachmentRatio
  ), 1);

  const unattachedCabinetIds = relevantEnvelopes
    .filter((envelope) => !attached.has(envelope.item.id))
    .map((envelope) => envelope.item.id);
  for (const run of floorRuns) {
    for (const gap of run.gaps.filter((candidate) => candidate.size > ADJACENCY_TOLERANCE)) {
      recommendations.push(
        `${run.wallId}: close ${gap.size} m internal gap between ${gap.leftCabinetId} and ${gap.rightCabinetId}`,
      );
    }
    if (run.startGap > 0.1) {
      recommendations.push(`${run.wallId}: reduce the ${run.startGap} m unused space at the start of the floor run`);
    }
    if (run.endGap > 0.1) {
      recommendations.push(`${run.wallId}: reduce the ${run.endGap} m unused space at the end of the floor run`);
    }
  }
  if (floorSummary.wallUtilization < TARGETS.floorWallUtilization) {
    recommendations.push(
      `Increase floor-cabinet use of active walls from ${floorSummary.wallUtilization} to at least ${TARGETS.floorWallUtilization}; keep residual space at run ends only.`,
    );
  }
  if (unattachedCabinetIds.length > 0) {
    recommendations.push(`Attach cabinets to a room wall: ${unattachedCabinetIds.join(", ")}`);
  }

  const targetChecks = {
    noHardErrors: hardErrors.length === 0,
    compactnessScore: compactnessScore >= TARGETS.compactnessScore,
    floorRunContinuity: floorSummary.runContinuity >= TARGETS.floorRunContinuity,
    floorWallUtilization: floorSummary.wallUtilization >= TARGETS.floorWallUtilization,
    largestInternalGap: floorSummary.largestInternalGap <= TARGETS.largestInternalGap,
    allFloorCabinetsWallAttached: attachedFloorCount === floorEnvelopes.length,
  };
  const targetsMet = Object.values(targetChecks).every(Boolean);
  return {
    validatorVersion: "1.1.0",
    scene: path.basename(scene.__sourcePath ?? "scene.json"),
    status: targetsMet ? "pass" : "refine",
    hardValid: hardErrors.length === 0,
    targetsMet,
    thresholds: {
      adjacencyTolerance: ADJACENCY_TOLERANCE,
      wallAttachmentTolerance: WALL_ATTACHMENT_TOLERANCE,
      ...TARGETS,
    },
    metrics: {
      compactnessScore,
      openings: {
        total: openings.length,
        doors: openings.filter(({ opening }) => opening.type === "door").length,
        windows: openings.filter(({ opening }) => opening.type === "window").length,
      },
      floorAttachmentRatio: round(floorAttachmentRatio),
      unattachedCabinetCount: unattachedCabinetIds.length,
      unattachedCabinetIds,
      floor: floorSummary,
      wall: wallSummary,
    },
    targetChecks,
    hardErrors,
    recommendations,
    runs,
  };
}

function usage() {
  console.error("Usage: node scripts/validate_kitchen_scene.mjs <scene.json> [--output <metrics.json>]");
}

const argumentsList = process.argv.slice(2);
const sceneArgument = argumentsList[0];
if (!sceneArgument || sceneArgument.startsWith("--")) {
  usage();
  process.exitCode = 1;
} else {
  try {
    const scenePath = path.resolve(process.cwd(), sceneArgument);
    const scene = readJson(scenePath);
    scene.__sourcePath = scenePath;
    const result = validateScene(scene, buildCatalogs());
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    const outputIndex = argumentsList.indexOf("--output");
    if (outputIndex >= 0) {
      const outputArgument = argumentsList[outputIndex + 1];
      if (!outputArgument) throw new Error("--output requires a file path");
      fs.writeFileSync(path.resolve(process.cwd(), outputArgument), serialized, "utf8");
    }
    process.stdout.write(serialized);
  } catch (error) {
    console.error(`Validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
