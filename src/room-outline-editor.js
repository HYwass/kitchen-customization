const SVG_NS = "http://www.w3.org/2000/svg";
const VIEW_WIDTH = 720;
const VIEW_HEIGHT = 500;
const PADDING = 40;
const SCALE = 70;
const GRID_STEP = 0.1;
const MAJOR_GRID_STEP = 0.5;
const EPSILON = 1e-6;

const TEMPLATES = {
  rectangle: [[0, 0], [4.8, 0], [4.8, 3.6], [0, 3.6]],
  l_shape: [[0, 0], [4.8, 0], [4.8, 2.2], [3.2, 2.2], [3.2, 3.6], [0, 3.6]],
  u_shape: [[0, 0], [5.5, 0], [5.5, 4], [4, 4], [4, 1.6], [1.5, 1.6], [1.5, 4], [0, 4]],
};

function roundCoordinate(value) {
  return Math.round(value / GRID_STEP) * GRID_STEP;
}

function cleanNumber(value) {
  return Number(value.toFixed(3));
}

function samePoint(left, right) {
  return Math.abs(left[0] - right[0]) < EPSILON && Math.abs(left[1] - right[1]) < EPSILON;
}

function signedArea(points) {
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2;
}

function polygonArea(points) {
  return Math.abs(signedArea(points));
}

function removeRedundantPoints(points) {
  const unique = points.filter((point, index) => index === 0 || !samePoint(point, points[index - 1]));
  if (unique.length > 1 && samePoint(unique[0], unique.at(-1))) unique.pop();
  let changed = true;
  while (changed && unique.length >= 4) {
    changed = false;
    for (let index = 0; index < unique.length; index += 1) {
      const previous = unique[(index - 1 + unique.length) % unique.length];
      const current = unique[index];
      const next = unique[(index + 1) % unique.length];
      const collinear = Math.abs(previous[0] - current[0]) < EPSILON && Math.abs(current[0] - next[0]) < EPSILON
        || Math.abs(previous[1] - current[1]) < EPSILON && Math.abs(current[1] - next[1]) < EPSILON;
      if (collinear) {
        unique.splice(index, 1);
        changed = true;
        break;
      }
    }
  }
  return unique;
}

function normalizeOutline(points) {
  let normalized = removeRedundantPoints(points).map(([x, y]) => [cleanNumber(x), cleanNumber(y)]);
  const minX = Math.min(...normalized.map((point) => point[0]));
  const minY = Math.min(...normalized.map((point) => point[1]));
  normalized = normalized.map(([x, y]) => [cleanNumber(x - minX), cleanNumber(y - minY)]);
  if (signedArea(normalized) < 0) normalized.reverse();
  const startIndex = normalized.reduce((best, point, index) => {
    const bestPoint = normalized[best];
    return point[1] < bestPoint[1] - EPSILON
      || Math.abs(point[1] - bestPoint[1]) < EPSILON && point[0] < bestPoint[0]
      ? index
      : best;
  }, 0);
  return [...normalized.slice(startIndex), ...normalized.slice(0, startIndex)];
}

function orientation(a, b, c) {
  const value = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
  if (Math.abs(value) < EPSILON) return 0;
  return value > 0 ? 1 : 2;
}

function pointOnSegment(a, b, point) {
  return point[0] <= Math.max(a[0], b[0]) + EPSILON
    && point[0] >= Math.min(a[0], b[0]) - EPSILON
    && point[1] <= Math.max(a[1], b[1]) + EPSILON
    && point[1] >= Math.min(a[1], b[1]) - EPSILON
    && orientation(a, b, point) === 0;
}

function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  return o1 === 0 && pointOnSegment(a, b, c)
    || o2 === 0 && pointOnSegment(a, b, d)
    || o3 === 0 && pointOnSegment(c, d, a)
    || o4 === 0 && pointOnSegment(c, d, b);
}

function validateClosedOutline(points) {
  if (points.length < 4) return "房间至少需要四个转角";
  if (polygonArea(points) < 1) return "房间面积不能小于 1 ㎡";
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (samePoint(current, next)) return "存在长度为零的墙体";
    if (Math.abs(current[0] - next[0]) > EPSILON && Math.abs(current[1] - next[1]) > EPSILON) {
      return "当前仅支持水平或垂直墙体";
    }
  }
  for (let first = 0; first < points.length; first += 1) {
    const firstNext = (first + 1) % points.length;
    for (let second = first + 1; second < points.length; second += 1) {
      const secondNext = (second + 1) % points.length;
      const adjacent = first === second || firstNext === second || secondNext === first;
      if (adjacent) continue;
      if (segmentsIntersect(points[first], points[firstNext], points[second], points[secondNext])) {
        return "墙体不能交叉或重叠";
      }
    }
  }
  return null;
}

function worldToView([x, y]) {
  return [PADDING + x * SCALE, VIEW_HEIGHT - PADDING - y * SCALE];
}

function eventToWorld(svg, event) {
  const rect = svg.getBoundingClientRect();
  const viewX = (event.clientX - rect.left) * VIEW_WIDTH / rect.width;
  const viewY = (event.clientY - rect.top) * VIEW_HEIGHT / rect.height;
  const maxX = (VIEW_WIDTH - PADDING * 2) / SCALE;
  const maxY = (VIEW_HEIGHT - PADDING * 2) / SCALE;
  return [
    cleanNumber(Math.max(0, Math.min(maxX, roundCoordinate((viewX - PADDING) / SCALE)))),
    cleanNumber(Math.max(0, Math.min(maxY, roundCoordinate((VIEW_HEIGHT - PADDING - viewY) / SCALE)))),
  ];
}

function orthogonalPoint(previous, candidate) {
  const deltaX = Math.abs(candidate[0] - previous[0]);
  const deltaY = Math.abs(candidate[1] - previous[1]);
  return deltaX >= deltaY ? [candidate[0], previous[1]] : [previous[0], candidate[1]];
}

function formatLength(value) {
  return `${Number(value.toFixed(2))} m`;
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

export function createRoomOutlineEditor({ input, svg, status, summary, coordinateOutput, buttons }) {
  let points = [];
  let closed = true;
  let hoverPoint = null;
  let wallDrag = null;

  try {
    points = normalizeOutline(JSON.parse(input.value));
  } catch {
    points = TEMPLATES.rectangle.map((point) => [...point]);
  }

  function updateInput() {
    if (!closed) return;
    points = normalizeOutline(points);
    input.value = JSON.stringify(points);
    coordinateOutput.textContent = input.value;
  }

  function drawGrid() {
    const grid = svgElement("g", { class: "outline-grid" });
    const maxX = (VIEW_WIDTH - PADDING * 2) / SCALE;
    const maxY = (VIEW_HEIGHT - PADDING * 2) / SCALE;
    for (let value = 0; value <= maxX + EPSILON; value += MAJOR_GRID_STEP) {
      const [x] = worldToView([value, 0]);
      grid.append(svgElement("line", { x1: x, y1: PADDING, x2: x, y2: VIEW_HEIGHT - PADDING }));
    }
    for (let value = 0; value <= maxY + EPSILON; value += MAJOR_GRID_STEP) {
      const [, y] = worldToView([0, value]);
      grid.append(svgElement("line", { x1: PADDING, y1: y, x2: VIEW_WIDTH - PADDING, y2: y }));
    }
    svg.append(grid);
  }

  function drawWall(start, end, index, interactive) {
    const [x1, y1] = worldToView(start);
    const [x2, y2] = worldToView(end);
    svg.append(svgElement("line", { class: "outline-wall", x1, y1, x2, y2 }));
    if (interactive) {
      svg.append(svgElement("line", {
        class: "outline-wall-hit",
        x1,
        y1,
        x2,
        y2,
        "data-wall-index": index,
      }));
    }
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    const horizontal = Math.abs(end[1] - start[1]) < EPSILON;
    const label = svgElement("text", {
      class: "outline-length",
      x: (x1 + x2) / 2 + (horizontal ? 0 : 14),
      y: (y1 + y2) / 2 + (horizontal ? -10 : 0),
      "text-anchor": horizontal ? "middle" : "start",
    });
    label.textContent = formatLength(length);
    svg.append(label);
  }

  function render() {
    svg.replaceChildren();
    drawGrid();

    if (closed && points.length >= 4) {
      const polygon = svgElement("polygon", {
        class: "outline-room-fill",
        points: points.map((point) => worldToView(point).join(",")).join(" "),
      });
      svg.append(polygon);
    }

    const segmentCount = closed ? points.length : Math.max(0, points.length - 1);
    for (let index = 0; index < segmentCount; index += 1) {
      drawWall(points[index], points[(index + 1) % points.length], index, closed);
    }

    if (!closed && points.length && hoverPoint) {
      const candidate = orthogonalPoint(points.at(-1), hoverPoint);
      const [x1, y1] = worldToView(points.at(-1));
      const [x2, y2] = worldToView(candidate);
      svg.append(svgElement("line", { class: "outline-preview-wall", x1, y1, x2, y2 }));
    }

    points.forEach((point, index) => {
      const [cx, cy] = worldToView(point);
      svg.append(svgElement("circle", {
        class: `outline-vertex${!closed && index === 0 ? " start" : ""}`,
        cx,
        cy,
        r: !closed && index === 0 ? 7 : 5,
        "data-vertex-index": index,
      }));
    });

    const validError = closed ? validateClosedOutline(points) : null;
    if (closed && !validError) {
      const width = Math.max(...points.map((point) => point[0])) - Math.min(...points.map((point) => point[0]));
      const depth = Math.max(...points.map((point) => point[1])) - Math.min(...points.map((point) => point[1]));
      summary.textContent = `${formatLength(width)} × ${formatLength(depth)} · ${polygonArea(points).toFixed(2)} ㎡ · ${points.length} 面墙`;
      status.textContent = "拖动墙体可平行调整；所有尺寸自动吸附到 0.1 m。";
      status.classList.remove("error");
    } else {
      summary.textContent = `${points.length} 个转角${closed ? "" : " · 绘制中"}`;
      status.textContent = validError || "依次点击墙角。线段会自动保持水平或垂直，完成后点击“闭合房间”。";
      status.classList.toggle("error", Boolean(validError));
    }
    buttons.close.disabled = closed || points.length < 3;
    buttons.undo.disabled = closed ? points.length === 0 : points.length === 0;
    buttons.draw.classList.toggle("active", !closed);
  }

  function applyTemplate(name) {
    points = TEMPLATES[name].map((point) => [...point]);
    closed = true;
    hoverPoint = null;
    updateInput();
    render();
  }

  function closeRoom() {
    if (points.length < 3) return;
    const first = points[0];
    const last = points.at(-1);
    const candidates = [];
    if (Math.abs(first[0] - last[0]) < EPSILON || Math.abs(first[1] - last[1]) < EPSILON) {
      candidates.push(points);
    } else {
      candidates.push([...points, [first[0], last[1]]]);
      candidates.push([...points, [last[0], first[1]]]);
    }
    const valid = candidates
      .map((candidate) => normalizeOutline(candidate))
      .find((candidate) => !validateClosedOutline(candidate));
    if (!valid) {
      status.textContent = "无法自动闭合：当前墙体会发生交叉，请撤销最后几个转角后重试。";
      status.classList.add("error");
      return;
    }
    points = valid;
    closed = true;
    hoverPoint = null;
    updateInput();
    render();
  }

  svg.addEventListener("pointermove", (event) => {
    const candidate = eventToWorld(svg, event);
    if (wallDrag) {
      points = wallDrag.original.map((point) => [...point]);
      const startIndex = wallDrag.index;
      const endIndex = (startIndex + 1) % points.length;
      const start = points[startIndex];
      const end = points[endIndex];
      if (Math.abs(start[1] - end[1]) < EPSILON) {
        start[1] = candidate[1];
        end[1] = candidate[1];
      } else {
        start[0] = candidate[0];
        end[0] = candidate[0];
      }
      render();
      return;
    }
    if (!closed) {
      hoverPoint = candidate;
      render();
    }
  });

  svg.addEventListener("pointerleave", () => {
    if (!closed && !wallDrag) {
      hoverPoint = null;
      render();
    }
  });

  svg.addEventListener("pointerdown", (event) => {
    if (!closed) return;
    const wall = event.target.closest?.("[data-wall-index]");
    if (!wall) return;
    wallDrag = {
      index: Number(wall.dataset.wallIndex),
      original: points.map((point) => [...point]),
    };
    svg.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  svg.addEventListener("pointerup", (event) => {
    if (!wallDrag) return;
    const original = wallDrag.original;
    wallDrag = null;
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    const normalized = normalizeOutline(points);
    const error = validateClosedOutline(normalized);
    if (error) {
      points = original;
      status.textContent = `无法移动墙体：${error}`;
      status.classList.add("error");
    } else {
      points = normalized;
      updateInput();
    }
    render();
  });

  svg.addEventListener("click", (event) => {
    if (closed || wallDrag) return;
    const candidate = eventToWorld(svg, event);
    if (!points.length) {
      points.push(candidate);
    } else if (points.length >= 3 && samePoint(candidate, points[0])) {
      closeRoom();
      return;
    } else {
      const next = orthogonalPoint(points.at(-1), candidate);
      if (!samePoint(next, points.at(-1))) points.push(next);
    }
    render();
  });

  buttons.rectangle.addEventListener("click", () => applyTemplate("rectangle"));
  buttons.lShape.addEventListener("click", () => applyTemplate("l_shape"));
  buttons.uShape.addEventListener("click", () => applyTemplate("u_shape"));
  buttons.draw.addEventListener("click", () => {
    points = [];
    closed = false;
    hoverPoint = null;
    render();
  });
  buttons.undo.addEventListener("click", () => {
    if (closed) closed = false;
    points.pop();
    hoverPoint = null;
    render();
  });
  buttons.close.addEventListener("click", closeRoom);

  updateInput();
  render();
  return {
    getOutline: () => closed ? normalizeOutline(points) : null,
    isComplete: () => closed && !validateClosedOutline(points),
    setOutline: (outline) => {
      if (!Array.isArray(outline)) throw new Error("识别结果没有有效的房间边界");
      const candidate = normalizeOutline(outline.map((point) => [Number(point[0]), Number(point[1])]));
      const error = candidate.some((point) => point.some((value) => !Number.isFinite(value)))
        ? "房间边界包含无效坐标"
        : validateClosedOutline(candidate);
      if (error) throw new Error(error);
      points = candidate;
      closed = true;
      hoverPoint = null;
      updateInput();
      render();
    },
  };
}
