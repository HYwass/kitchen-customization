import {
  APPLIANCE_ASSETS,
  CABINET_ASSETS,
  FURNITURE_ASSETS,
} from "./catalog.js";

const PAGE_WIDTH = 1754;
const PAGE_HEIGHT = 1240;
const PDF_WIDTH = 841.89;
const PDF_HEIGHT = 595.28;
const DRAWING_BOTTOM = 1055;
const EPSILON = 1e-7;

function createPage() {
  const canvas = document.createElement("canvas");
  canvas.width = PAGE_WIDTH;
  canvas.height = PAGE_HEIGHT;
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  context.lineCap = "square";
  context.lineJoin = "miter";
  return { canvas, context };
}

function cabinetAsset(item) {
  return CABINET_ASSETS[item.cabinetAssetId] ?? null;
}

function standaloneAsset(item) {
  if (item.assetKind === "appliance") return APPLIANCE_ASSETS[item.assetId] ?? null;
  if (item.assetKind === "furniture") return FURNITURE_ASSETS[item.assetId] ?? null;
  return null;
}

function itemDimensions(item) {
  return cabinetAsset(item)?.dimensions ?? standaloneAsset(item)?.bodySize ?? null;
}

function transformPoint(item, localX, localY) {
  const cosine = Math.cos(item.rotationZ ?? 0);
  const sine = Math.sin(item.rotationZ ?? 0);
  return [
    item.position[0] + localX * cosine - localY * sine,
    item.position[1] + localX * sine + localY * cosine,
  ];
}

function itemFootprint(item) {
  const dimensions = itemDimensions(item);
  if (!dimensions) return [];
  const [width, depth] = dimensions;
  return [
    transformPoint(item, -width / 2, -depth / 2),
    transformPoint(item, width / 2, -depth / 2),
    transformPoint(item, width / 2, depth / 2),
    transformPoint(item, -width / 2, depth / 2),
  ];
}

function wallGeometry(room, wallIndex) {
  const start = room.outline[wallIndex];
  const end = room.outline[(wallIndex + 1) % room.outline.length];
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  return {
    index: wallIndex,
    start,
    end,
    length,
    direction: [dx / length, dy / length],
  };
}

function distanceToWall(point, wall) {
  const relativeX = point[0] - wall.start[0];
  const relativeY = point[1] - wall.start[1];
  const along = Math.max(0, Math.min(wall.length,
    relativeX * wall.direction[0] + relativeY * wall.direction[1]));
  const closest = [
    wall.start[0] + wall.direction[0] * along,
    wall.start[1] + wall.direction[1] * along,
  ];
  return Math.hypot(point[0] - closest[0], point[1] - closest[1]);
}

function itemBackCenter(item) {
  const dimensions = itemDimensions(item);
  return dimensions ? transformPoint(item, 0, -dimensions[1] / 2) : item.position.slice(0, 2);
}

function nearestWallIndex(scene, item) {
  const point = itemBackCenter(item);
  let best = { index: 0, distance: Infinity };
  for (let index = 0; index < scene.room.outline.length; index += 1) {
    const distance = distanceToWall(point, wallGeometry(scene.room, index));
    if (distance < best.distance) best = { index, distance };
  }
  return best.index;
}

function upperCabinetWallIndexes(scene) {
  return [...new Set(scene.objects
    .filter((item) => ["wall", "top"].includes(cabinetAsset(item)?.family))
    .map((item) => nearestWallIndex(scene, item)))]
    .sort((left, right) => left - right);
}

function millimetres(metres) {
  return String(Math.round(Math.abs(metres) * 1000));
}

function drawText(context, text, x, y, options = {}) {
  context.save();
  context.fillStyle = options.color ?? "#222222";
  context.font = `${options.weight ?? 400} ${options.size ?? 17}px "Microsoft YaHei", sans-serif`;
  context.textAlign = options.align ?? "center";
  context.textBaseline = options.baseline ?? "middle";
  if (options.rotate) {
    context.translate(x, y);
    context.rotate(options.rotate);
    context.fillText(text, 0, 0);
  } else {
    context.fillText(text, x, y);
  }
  context.restore();
}

function drawDimensionHorizontal(context, x1, x2, y, label, witnessY1, witnessY2 = witnessY1) {
  context.save();
  context.strokeStyle = "#4b4b4b";
  context.fillStyle = "#4b4b4b";
  context.lineWidth = 1.2;
  context.beginPath();
  context.moveTo(x1, witnessY1);
  context.lineTo(x1, y + 7);
  context.moveTo(x2, witnessY2);
  context.lineTo(x2, y + 7);
  context.moveTo(x1, y);
  context.lineTo(x2, y);
  context.stroke();
  context.beginPath();
  context.moveTo(x1, y);
  context.lineTo(x1 + 8, y - 4);
  context.lineTo(x1 + 8, y + 4);
  context.closePath();
  context.moveTo(x2, y);
  context.lineTo(x2 - 8, y - 4);
  context.lineTo(x2 - 8, y + 4);
  context.closePath();
  context.fill();
  const textWidth = context.measureText(label).width + 12;
  context.fillStyle = "#ffffff";
  context.fillRect((x1 + x2 - textWidth) / 2, y - 10, textWidth, 20);
  drawText(context, label, (x1 + x2) / 2, y, { size: 14 });
  context.restore();
}

function drawDimensionVertical(context, y1, y2, x, label, witnessX1, witnessX2 = witnessX1) {
  context.save();
  context.strokeStyle = "#4b4b4b";
  context.fillStyle = "#4b4b4b";
  context.lineWidth = 1.2;
  context.beginPath();
  context.moveTo(witnessX1, y1);
  context.lineTo(x - 7, y1);
  context.moveTo(witnessX2, y2);
  context.lineTo(x - 7, y2);
  context.moveTo(x, y1);
  context.lineTo(x, y2);
  context.stroke();
  context.beginPath();
  context.moveTo(x, y1);
  context.lineTo(x - 4, y1 + 8);
  context.lineTo(x + 4, y1 + 8);
  context.closePath();
  context.moveTo(x, y2);
  context.lineTo(x - 4, y2 - 8);
  context.lineTo(x + 4, y2 - 8);
  context.closePath();
  context.fill();
  drawText(context, label, x, (y1 + y2) / 2, { size: 14, rotate: -Math.PI / 2 });
  context.restore();
}

function drawWallDimension(context, scene, wallIndex, map) {
  const wall = wallGeometry(scene.room, wallIndex);
  const start = map(wall.start);
  const end = map(wall.end);
  const worldOutward = [wall.direction[1], -wall.direction[0]];
  const outwardReference = map([
    wall.start[0] + worldOutward[0] * 0.1,
    wall.start[1] + worldOutward[1] * 0.1,
  ]);
  let normalX = outwardReference[0] - start[0];
  let normalY = outwardReference[1] - start[1];
  const normalLength = Math.hypot(normalX, normalY) || 1;
  normalX /= normalLength;
  normalY /= normalLength;
  const offset = 34;
  const a = [start[0] + normalX * offset, start[1] + normalY * offset];
  const b = [end[0] + normalX * offset, end[1] + normalY * offset];
  context.save();
  context.strokeStyle = "#555555";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(start[0], start[1]);
  context.lineTo(a[0] + normalX * 6, a[1] + normalY * 6);
  context.moveTo(end[0], end[1]);
  context.lineTo(b[0] + normalX * 6, b[1] + normalY * 6);
  context.moveTo(a[0], a[1]);
  context.lineTo(b[0], b[1]);
  context.stroke();
  const directionX = (end[0] - start[0]) / Math.max(1, Math.hypot(end[0] - start[0], end[1] - start[1]));
  const directionY = (end[1] - start[1]) / Math.max(1, Math.hypot(end[0] - start[0], end[1] - start[1]));
  for (const point of [a, b]) {
    context.beginPath();
    context.moveTo(point[0] - normalX * 5 - directionX * 5, point[1] - normalY * 5 - directionY * 5);
    context.lineTo(point[0] + normalX * 5 + directionX * 5, point[1] + normalY * 5 + directionY * 5);
    context.stroke();
  }
  let angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
  if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
  drawText(context, millimetres(wall.length), (a[0] + b[0]) / 2 + normalX * 12,
    (a[1] + b[1]) / 2 + normalY * 12, { size: 13, rotate: angle });
  context.restore();
}

function drawTitleBlock(context, scene, drawingTitle, pageNumber, pageCount) {
  const left = 55;
  const right = PAGE_WIDTH - 55;
  const top = 1085;
  const bottom = PAGE_HEIGHT - 45;
  context.strokeStyle = "#555555";
  context.lineWidth = 1.5;
  context.strokeRect(left, top, right - left, bottom - top);
  context.beginPath();
  context.moveTo(left, 1153);
  context.lineTo(right, 1153);
  context.moveTo(330, top);
  context.lineTo(330, bottom);
  context.moveTo(910, top);
  context.lineTo(910, 1153);
  context.moveTo(1245, top);
  context.lineTo(1245, 1153);
  context.stroke();
  drawText(context, "KITCHEN", 192, 1120, { size: 30, weight: 700, color: "#ec613d" });
  drawText(context, scene.name || "Kitchen design", 620, 1118, { size: 20, weight: 600 });
  drawText(context, drawingTitle, 1077, 1118, { size: 20, weight: 600 });
  drawText(context, `Page ${pageNumber} / ${pageCount}`, 1468, 1118, { size: 17 });
  drawText(context, "All dimensions are in millimetres · Verify site dimensions before installation", 1040, 1178, { size: 15, color: "#555555" });
}

function worldBounds(points) {
  return points.reduce((bounds, [x, y]) => ({
    minX: Math.min(bounds.minX, x),
    maxX: Math.max(bounds.maxX, x),
    minY: Math.min(bounds.minY, y),
    maxY: Math.max(bounds.maxY, y),
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
}

function drawPolygon(context, points, map, options = {}) {
  if (!points.length) return;
  context.save();
  context.beginPath();
  points.forEach((point, index) => {
    const [x, y] = map(point);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.closePath();
  if (options.fill) {
    context.fillStyle = options.fill;
    context.fill();
  }
  context.strokeStyle = options.stroke ?? "#222222";
  context.lineWidth = options.lineWidth ?? 2;
  context.stroke();
  context.restore();
}

function drawPlanPage(scene, pageNumber, pageCount) {
  const { canvas, context } = createPage();
  const bounds = worldBounds(scene.room.outline);
  const width = Math.max(bounds.maxX - bounds.minX, 0.1);
  const height = Math.max(bounds.maxY - bounds.minY, 0.1);
  const drawing = { left: 230, top: 155, width: 1290, height: 760 };
  const scale = Math.min(drawing.width / width, drawing.height / height);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const map = ([x, y]) => [
    drawing.left + drawing.width / 2 + (x - centerX) * scale,
    drawing.top + drawing.height / 2 - (y - centerY) * scale,
  ];

  drawText(context, "TOP PLAN", PAGE_WIDTH / 2, 65, { size: 24, weight: 700 });
  for (const region of scene.worktop?.regions ?? []) {
    drawPolygon(context, region.outline, map, { fill: "#ece8df", stroke: "#9b9488", lineWidth: 1.5 });
  }
  drawPolygon(context, scene.room.outline, map, { stroke: "#999999", lineWidth: Math.max(12, scene.room.wallThickness * scale) });
  drawPolygon(context, scene.room.outline, map, { stroke: "#222222", lineWidth: 1.5 });
  scene.room.outline.forEach((_, wallIndex) => drawWallDimension(context, scene, wallIndex, map));

  scene.room.openings.forEach((opening) => {
    const wall = wallGeometry(scene.room, opening.wallIndex);
    const startOffset = opening.centerOffset - opening.width / 2;
    const endOffset = opening.centerOffset + opening.width / 2;
    const start = [wall.start[0] + wall.direction[0] * startOffset, wall.start[1] + wall.direction[1] * startOffset];
    const end = [wall.start[0] + wall.direction[0] * endOffset, wall.start[1] + wall.direction[1] * endOffset];
    const [x1, y1] = map(start);
    const [x2, y2] = map(end);
    context.strokeStyle = opening.type === "door" ? "#417a99" : "#63a4c7";
    context.lineWidth = 8;
    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.stroke();
    drawText(context, opening.type === "door" ? "D" : "W", (x1 + x2) / 2, (y1 + y2) / 2, { size: 13, color: "#27566f" });
  });

  let cabinetNumber = 1;
  for (const item of scene.objects) {
    const footprint = itemFootprint(item);
    if (!footprint.length) continue;
    const cabinet = cabinetAsset(item);
    drawPolygon(context, footprint, map, {
      fill: cabinet ? (cabinet.family === "wall" || cabinet.family === "top" ? "rgba(220,225,228,.48)" : "#f8f8f6") : "#f2f0eb",
      stroke: cabinet ? "#222222" : "#777777",
      lineWidth: cabinet?.family === "wall" || cabinet?.family === "top" ? 1 : 2,
    });
    if (cabinet) {
      const [labelX, labelY] = map(item.position);
      drawText(context, String(cabinetNumber), labelX, labelY, { size: 14, weight: 700, color: "#e55d36" });
      if (cabinet.dimensions[0] * scale >= 62 && cabinet.dimensions[1] * scale >= 42) {
        drawText(context, `${millimetres(cabinet.dimensions[0])}×${millimetres(cabinet.dimensions[1])}`,
          labelX, labelY + 17, { size: 10, color: "#666666" });
      }
      cabinetNumber += 1;
    }
  }

  const [roomLeft, roomTop] = map([bounds.minX, bounds.maxY]);
  const [roomRight, roomBottom] = map([bounds.maxX, bounds.minY]);
  drawDimensionHorizontal(context, roomLeft, roomRight, roomTop - 65, millimetres(width), roomTop);
  drawDimensionVertical(context, roomTop, roomBottom, roomLeft - 65, millimetres(height), roomLeft);

  drawTitleBlock(context, scene, "Top plan", pageNumber, pageCount);
  return canvas;
}

function wallProjectionRange(item, wall) {
  const offsets = itemFootprint(item).map(([x, y]) =>
    (x - wall.start[0]) * wall.direction[0] + (y - wall.start[1]) * wall.direction[1]);
  return { min: Math.min(...offsets), max: Math.max(...offsets) };
}

function drawFrontPattern(context, item, asset, left, top, width, height) {
  const layout = item.frontAssetId?.split("__").at(-1) ?? "";
  context.strokeStyle = "#777777";
  context.lineWidth = 1;
  if (layout.includes("DOUBLE")) {
    context.beginPath();
    context.moveTo(left + width / 2, top);
    context.lineTo(left + width / 2, top + height);
    context.stroke();
  }
  const drawerCount = Number(layout.match(/DRAWERS_(\d)/)?.[1] ?? 0);
  for (let index = 1; index < drawerCount; index += 1) {
    const y = top + height * index / drawerCount;
    context.beginPath();
    context.moveTo(left, y);
    context.lineTo(left + width, y);
    context.stroke();
  }
  if (asset.family !== "wall" && asset.family !== "top") {
    context.strokeStyle = "#a6a6a6";
    context.beginPath();
    context.moveTo(left, top + height - Math.min(12, height * 0.08));
    context.lineTo(left + width, top + height - Math.min(12, height * 0.08));
    context.stroke();
  }
}

function drawElevationPage(scene, wallIndex, pageNumber, pageCount) {
  const { canvas, context } = createPage();
  const wall = wallGeometry(scene.room, wallIndex);
  const floor = scene.room.floorElevation;
  const roomHeight = scene.room.height;
  const drawing = { left: 240, top: 135, width: 1260, height: 780 };
  const scale = Math.min(drawing.width / wall.length, drawing.height / roomHeight);
  const originX = drawing.left + (drawing.width - wall.length * scale) / 2;
  const floorY = drawing.top + (drawing.height + roomHeight * scale) / 2;
  const mapX = (offset) => originX + offset * scale;
  const mapZ = (z) => floorY - (z - floor) * scale;

  drawText(context, `WALL ${wallIndex + 1} · ELEVATION`, PAGE_WIDTH / 2, 65, { size: 24, weight: 700 });
  context.fillStyle = "#fcfcfb";
  context.strokeStyle = "#333333";
  context.lineWidth = 2;
  context.fillRect(mapX(0), mapZ(floor + roomHeight), wall.length * scale, roomHeight * scale);
  context.strokeRect(mapX(0), mapZ(floor + roomHeight), wall.length * scale, roomHeight * scale);

  for (const opening of scene.room.openings.filter((candidate) => candidate.wallIndex === wallIndex)) {
    const left = mapX(opening.centerOffset - opening.width / 2);
    const top = mapZ(floor + opening.bottomOffset + opening.height);
    const width = opening.width * scale;
    const height = opening.height * scale;
    context.fillStyle = opening.type === "door" ? "#f7f4ee" : "#eaf4f8";
    context.strokeStyle = opening.type === "door" ? "#666666" : "#5b91ac";
    context.lineWidth = 2;
    context.fillRect(left, top, width, height);
    context.strokeRect(left, top, width, height);
    drawText(context, opening.type === "door" ? "DOOR" : "WINDOW", left + width / 2, top + height / 2, { size: 14, color: "#555555" });
  }

  const wallItems = scene.objects
    .filter((item) => cabinetAsset(item) && nearestWallIndex(scene, item) === wallIndex)
    .map((item) => ({ item, asset: cabinetAsset(item), range: wallProjectionRange(item, wall) }))
    .sort((left, right) => left.range.min - right.range.min || left.item.position[2] - right.item.position[2]);

  wallItems.forEach(({ item, asset, range }, index) => {
    const bottom = item.position[2];
    const topZ = bottom + asset.dimensions[2];
    const left = mapX(range.min);
    const top = mapZ(topZ);
    const width = Math.max(1, (range.max - range.min) * scale);
    const height = asset.dimensions[2] * scale;
    context.fillStyle = ["wall", "top"].includes(asset.family) ? "#f4f5f4" : "#faf9f6";
    context.strokeStyle = "#222222";
    context.lineWidth = 2;
    context.fillRect(left, top, width, height);
    context.strokeRect(left, top, width, height);
    drawFrontPattern(context, item, asset, left, top, width, height);
    drawText(context, String(index + 1), left + width / 2, top + height / 2, { size: 14, weight: 700, color: "#e55d36" });
    if (item.applianceAssetIds?.length) {
      const abbreviation = item.applianceAssetIds
        .map((id) => id.replace("APPL_", "").split("_")[0])
        .join("+");
      drawText(context, abbreviation, left + width / 2, top + height * 0.68, { size: 11, color: "#555555" });
    }
  });

  if (wallItems.some(({ asset }) => !["wall", "top"].includes(asset.family))) {
    const worktopY = mapZ(scene.worktop.elevation);
    context.strokeStyle = "#8c8171";
    context.lineWidth = 5;
    context.beginPath();
    context.moveTo(mapX(0), worktopY);
    context.lineTo(mapX(wall.length), worktopY);
    context.stroke();
  }

  const dimensionY = floorY + 48;
  wallItems
    .filter(({ asset }) => !["wall", "top"].includes(asset.family))
    .forEach(({ range }) => {
      drawDimensionHorizontal(context, mapX(range.min), mapX(range.max), dimensionY,
        millimetres(range.max - range.min), floorY);
    });
  drawDimensionHorizontal(context, mapX(0), mapX(wall.length), floorY + 94, millimetres(wall.length), floorY);
  drawDimensionVertical(context, mapZ(floor + roomHeight), floorY, mapX(wall.length) + 62,
    millimetres(roomHeight), mapX(wall.length));

  const elevations = [...new Set(wallItems.flatMap(({ item, asset }) => [
    item.position[2] - floor,
    item.position[2] - floor + asset.dimensions[2],
  ]).filter((value) => value > EPSILON && value < roomHeight - EPSILON).map((value) => Number(value.toFixed(4))))]
    .sort((left, right) => left - right);
  elevations.forEach((elevation, index) => {
    const x = mapX(0) - 45 - index * 22;
    drawDimensionVertical(context, mapZ(floor + elevation), floorY, x, millimetres(elevation), mapX(0));
  });

  drawTitleBlock(context, scene, `Wall ${wallIndex + 1} elevation`, pageNumber, pageCount);
  return canvas;
}

function dataUrlBytes(dataUrl) {
  const binary = atob(dataUrl.split(",")[1]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function textBytes(value) {
  return new TextEncoder().encode(value);
}

function joinBytes(chunks) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function pdfObject(number, bodyChunks) {
  return joinBytes([textBytes(`${number} 0 obj\n`), ...bodyChunks, textBytes("\nendobj\n")]);
}

function buildPdf(canvases) {
  const objects = [];
  objects[1] = pdfObject(1, [textBytes("<< /Type /Catalog /Pages 2 0 R >>")]);
  const pageNumbers = canvases.map((_, index) => 3 + index * 3);
  objects[2] = pdfObject(2, [textBytes(`<< /Type /Pages /Count ${canvases.length} /Kids [${pageNumbers.map((number) => `${number} 0 R`).join(" ")}] >>`)]);

  canvases.forEach((canvas, index) => {
    const pageNumber = 3 + index * 3;
    const imageNumber = pageNumber + 1;
    const contentNumber = pageNumber + 2;
    const jpeg = dataUrlBytes(canvas.toDataURL("image/jpeg", 0.94));
    const content = textBytes(`q\n${PDF_WIDTH} 0 0 ${PDF_HEIGHT} 0 0 cm\n/Im0 Do\nQ`);
    objects[pageNumber] = pdfObject(pageNumber, [textBytes(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_WIDTH} ${PDF_HEIGHT}] /Resources << /XObject << /Im0 ${imageNumber} 0 R >> >> /Contents ${contentNumber} 0 R >>`,
    )]);
    objects[imageNumber] = pdfObject(imageNumber, [
      textBytes(`<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),
      jpeg,
      textBytes("\nendstream"),
    ]);
    objects[contentNumber] = pdfObject(contentNumber, [
      textBytes(`<< /Length ${content.length} >>\nstream\n`),
      content,
      textBytes("\nendstream"),
    ]);
  });

  const header = textBytes("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  const offsets = new Array(objects.length).fill(0);
  let cursor = header.length;
  const body = [];
  for (let number = 1; number < objects.length; number += 1) {
    offsets[number] = cursor;
    body.push(objects[number]);
    cursor += objects[number].length;
  }
  const xrefOffset = cursor;
  const xref = [`xref\n0 ${objects.length}\n`, "0000000000 65535 f \n"];
  for (let number = 1; number < objects.length; number += 1) {
    xref.push(`${String(offsets[number]).padStart(10, "0")} 00000 n \n`);
  }
  const trailer = `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Blob([joinBytes([header, ...body, textBytes(xref.join("")), textBytes(trailer)])], { type: "application/pdf" });
}

export function exportKitchenDrawings(scene) {
  const elevationWalls = upperCabinetWallIndexes(scene);
  const pageCount = 1 + elevationWalls.length;
  const canvases = [
    drawPlanPage(scene, 1, pageCount),
    ...elevationWalls.map((wallIndex, index) => drawElevationPage(scene, wallIndex, index + 2, pageCount)),
  ];
  const blob = buildPdf(canvases);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${(scene.name || "kitchen_design").replace(/[\\/:*?"<>|]+/g, "_")}_drawings.pdf`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { pageCount, elevationWallCount: elevationWalls.length };
}
