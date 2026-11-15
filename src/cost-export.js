import { buildPdf } from "./drawing-export.js";

const PAGE_WIDTH = 1754;
const PAGE_HEIGHT = 1240;
const MARGIN_X = 77;
const TABLE_WIDTH = 1600;
const ROW_HEIGHT = 56;
const FIRST_PAGE_ROWS = 14;
const FOLLOWING_PAGE_ROWS = 17;

const GROUP_LABELS = {
  furniture: "厨房家具",
  surfaces: "台面与饰面",
  appliances: "厨房电器",
};

const DETAIL_LABELS = {
  cabinet: "柜体/五金",
  front: "门板",
  handle: "拉手",
  furniture: "桌椅家具",
  worktop: "台面",
  backsplash: "墙面砖",
  panel: "侧板/填缝板",
  appliance: "电器/水槽",
};

const COLUMNS = [
  { key: "index", label: "序号", width: 60, align: "center" },
  { key: "category", label: "类别", width: 130, align: "center" },
  { key: "name", label: "项目及资产", width: 350, align: "left" },
  { key: "basis", label: "计价依据", width: 630, align: "left" },
  { key: "quantity", label: "数量", width: 110, align: "center" },
  { key: "unitPrice", label: "单价", width: 150, align: "right" },
  { key: "subtotal", label: "小计", width: 170, align: "right" },
];

function createPage() {
  const canvas = document.createElement("canvas");
  canvas.width = PAGE_WIDTH;
  canvas.height = PAGE_HEIGHT;
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  context.textBaseline = "middle";
  return { canvas, context };
}

function drawText(context, text, x, y, options = {}) {
  context.save();
  context.fillStyle = options.color ?? "#242723";
  context.font = `${options.weight ?? 400} ${options.size ?? 18}px "Microsoft YaHei", sans-serif`;
  context.textAlign = options.align ?? "left";
  context.textBaseline = options.baseline ?? "middle";
  context.fillText(String(text), x, y);
  context.restore();
}

function fitLines(context, text, maxWidth, maxLines = 2) {
  const content = String(text ?? "-");
  const lines = [];
  let current = "";
  for (const character of content) {
    const candidate = current + character;
    if (current && context.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = character;
      if (lines.length === maxLines - 1) break;
    } else {
      current = candidate;
    }
  }
  if (lines.length < maxLines && current) {
    const consumed = lines.join("").length + current.length;
    if (consumed < content.length) {
      while (current && context.measureText(`${current}…`).width > maxWidth) current = current.slice(0, -1);
      current += "…";
    }
    lines.push(current);
  }
  return lines;
}

function drawWrappedText(context, text, x, centerY, maxWidth, options = {}) {
  context.save();
  context.font = `${options.weight ?? 400} ${options.size ?? 15}px "Microsoft YaHei", sans-serif`;
  context.fillStyle = options.color ?? "#333630";
  context.textAlign = options.align ?? "left";
  context.textBaseline = "middle";
  const lines = fitLines(context, text, maxWidth, options.maxLines ?? 2);
  const lineHeight = options.lineHeight ?? 20;
  const firstY = centerY - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, index) => context.fillText(line, x, firstY + index * lineHeight));
  context.restore();
}

function formatMoney(value) {
  const amount = Number(value) || 0;
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatQuantity(row) {
  const value = Number(row.quantity);
  if (!Number.isFinite(value)) return "-";
  const formatted = row.unit === "㎡" ? value.toFixed(3) : String(value);
  return `${formatted} ${row.unit || ""}`.trim();
}

function drawDocumentHeader(context, scene, pageNumber, pageCount) {
  drawText(context, "KITCHEN STUDIO", MARGIN_X, 42, { size: 14, weight: 600, color: "#315e4d" });
  drawText(context, "厨房方案成本清单", MARGIN_X, 80, { size: 34, weight: 700 });
  drawText(context, scene.name || "未命名厨房", MARGIN_X, 119, { size: 17, color: "#686d66" });
  drawText(context, `生成时间：${new Date().toLocaleString("zh-CN")}`, PAGE_WIDTH - MARGIN_X, 78, {
    size: 14,
    color: "#686d66",
    align: "right",
  });
  drawText(context, `第 ${pageNumber} / ${pageCount} 页`, PAGE_WIDTH - MARGIN_X, 108, {
    size: 14,
    color: "#686d66",
    align: "right",
  });
  context.strokeStyle = "#315e4d";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(MARGIN_X, 142);
  context.lineTo(PAGE_WIDTH - MARGIN_X, 142);
  context.stroke();
}

function drawSummary(context, estimate) {
  const cards = [
    ["厨房家具", estimate.groups.furniture],
    ["台面与饰面", estimate.groups.surfaces],
    ["厨房电器", estimate.groups.appliances],
    ["方案总价", estimate.total],
  ];
  const gap = 18;
  const width = (TABLE_WIDTH - gap * 3) / 4;
  cards.forEach(([label, value], index) => {
    const x = MARGIN_X + index * (width + gap);
    context.fillStyle = index === cards.length - 1 ? "#315e4d" : "#f2f3ef";
    context.fillRect(x, 170, width, 105);
    drawText(context, label, x + 20, 198, {
      size: 15,
      color: index === cards.length - 1 ? "#e7f0eb" : "#686d66",
    });
    drawText(context, formatMoney(value), x + 20, 242, {
      size: 27,
      weight: 700,
      color: index === cards.length - 1 ? "#ffffff" : "#242723",
    });
  });
}

function drawTableHeader(context, top) {
  context.fillStyle = "#e6ebe7";
  context.fillRect(MARGIN_X, top, TABLE_WIDTH, 42);
  context.strokeStyle = "#aeb8b0";
  context.lineWidth = 1;
  context.strokeRect(MARGIN_X, top, TABLE_WIDTH, 42);
  let x = MARGIN_X;
  for (const column of COLUMNS) {
    const textX = column.align === "left" ? x + 10 : column.align === "right" ? x + column.width - 10 : x + column.width / 2;
    drawText(context, column.label, textX, top + 21, {
      size: 15,
      weight: 700,
      align: column.align,
    });
    x += column.width;
    context.beginPath();
    context.moveTo(x, top);
    context.lineTo(x, top + 42);
    context.stroke();
  }
}

function drawRow(context, row, rowIndex, top) {
  const y = top + rowIndex * ROW_HEIGHT;
  context.fillStyle = row.adjustment ? "#fbf7ee" : (rowIndex % 2 ? "#fafbf9" : "#ffffff");
  context.fillRect(MARGIN_X, y, TABLE_WIDTH, ROW_HEIGHT);
  context.strokeStyle = "#d9ddd8";
  context.lineWidth = 1;
  context.strokeRect(MARGIN_X, y, TABLE_WIDTH, ROW_HEIGHT);

  const values = {
    index: row.displayIndex,
    category: row.warning ? "未计价提示" : DETAIL_LABELS[row.detailKey] || GROUP_LABELS[row.group] || "其他",
    name: row.warning ? row.name : `${row.name}\n${row.assetId || "-"}`,
    basis: row.basis || "-",
    quantity: row.warning ? "-" : formatQuantity(row),
    unitPrice: row.warning ? "-" : formatMoney(row.unitPrice),
    subtotal: row.warning ? "-" : formatMoney(row.subtotal),
  };

  let x = MARGIN_X;
  for (const column of COLUMNS) {
    const textX = column.align === "left" ? x + 10 : column.align === "right" ? x + column.width - 10 : x + column.width / 2;
    const value = values[column.key];
    if (column.key === "name") {
      const [name, assetId] = String(value).split("\n");
      drawWrappedText(context, name, textX, y + 19, column.width - 20, { size: 15, maxLines: 1 });
      drawWrappedText(context, assetId || "", textX, y + 40, column.width - 20, { size: 12, color: "#777c75", maxLines: 1 });
    } else if (["basis"].includes(column.key)) {
      drawWrappedText(context, value, textX, y + ROW_HEIGHT / 2, column.width - 20, {
        size: 14,
        color: row.warning ? "#9a5c23" : "#4f544e",
        maxLines: 2,
      });
    } else {
      drawText(context, value, textX, y + ROW_HEIGHT / 2, {
        size: column.key === "category" ? 14 : 15,
        weight: column.key === "subtotal" ? 700 : 400,
        align: column.align,
        color: row.warning ? "#9a5c23" : "#30332f",
      });
    }
    x += column.width;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x, y + ROW_HEIGHT);
    context.stroke();
  }
}

function drawFooter(context, estimate, pageNumber, pageCount) {
  context.strokeStyle = "#c7ccc7";
  context.beginPath();
  context.moveTo(MARGIN_X, 1164);
  context.lineTo(PAGE_WIDTH - MARGIN_X, 1164);
  context.stroke();
  drawText(context, estimate.disclaimer, MARGIN_X, 1190, { size: 13, color: "#71766f" });
  drawText(context, `价格单位：${estimate.currency || "CNY"} · 分类金额按 ¥10 取整`, PAGE_WIDTH - MARGIN_X, 1190, {
    size: 13,
    color: "#71766f",
    align: "right",
  });
  if (pageNumber === pageCount) {
    drawText(context, `最终估算总价：${formatMoney(estimate.total)}`, PAGE_WIDTH - MARGIN_X, 1218, {
      size: 15,
      weight: 700,
      color: "#315e4d",
      align: "right",
    });
  }
}

function paginateRows(rows) {
  const pages = [];
  pages.push(rows.slice(0, FIRST_PAGE_ROWS));
  let offset = FIRST_PAGE_ROWS;
  while (offset < rows.length) {
    pages.push(rows.slice(offset, offset + FOLLOWING_PAGE_ROWS));
    offset += FOLLOWING_PAGE_ROWS;
  }
  return pages;
}

function safeFilename(value) {
  return String(value || "kitchen_design").replace(/[\\/:*?"<>|]+/g, "_");
}

export function exportKitchenCostBreakdown(scene, estimate) {
  if (!estimate?.lineItems) throw new Error("成本估算缺少逐项明细");
  const pricedRows = estimate.lineItems.map((row, index) => ({ ...row, displayIndex: index + 1 }));
  const warningRows = (estimate.warnings ?? []).map((warning, index) => ({
    displayIndex: `W${index + 1}`,
    warning: true,
    name: "未配置价格",
    basis: warning,
  }));
  const rows = [...pricedRows, ...warningRows];
  const pageRows = paginateRows(rows);
  const pageCount = pageRows.length;
  const canvases = pageRows.map((currentRows, pageIndex) => {
    const { canvas, context } = createPage();
    drawDocumentHeader(context, scene, pageIndex + 1, pageCount);
    if (pageIndex === 0) drawSummary(context, estimate);
    const tableTop = pageIndex === 0 ? 305 : 170;
    drawTableHeader(context, tableTop);
    currentRows.forEach((row, rowIndex) => drawRow(context, row, rowIndex, tableTop + 42));
    drawFooter(context, estimate, pageIndex + 1, pageCount);
    return canvas;
  });

  const blob = buildPdf(canvases);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeFilename(scene.name)}_cost_breakdown.pdf`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { pageCount, lineItemCount: pricedRows.length, warningCount: warningRows.length };
}
