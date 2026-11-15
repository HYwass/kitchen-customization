import "./token-usage.css";

const CATEGORY_ORDER = [
  "floorplan_recognition",
  "scene_generation",
  "editor_refinement",
  "image_reconstruction",
];

function formatTokens(value) {
  return new Intl.NumberFormat("zh-CN").format(Number(value) || 0);
}

function formatUsd(value) {
  if (!Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(Number(value));
}

function formatUsageCost(usage) {
  if ((usage?.records || 0) > 0 && usage.unpricedRecords === usage.records) return "未定价";
  const formatted = formatUsd(usage?.costUsd);
  return usage?.unpricedRecords ? `${formatted}+` : formatted;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function metricLine(usage) {
  return `输入 ${formatTokens(usage.inputTokens)} · 输出 ${formatTokens(usage.outputTokens)}`;
}

function renderDetails(container, summary) {
  const categories = CATEGORY_ORDER.map((id) => summary.categories?.[id]).filter(Boolean);
  const recentTasks = summary.recentTasks || [];
  container.innerHTML = `
    <div class="token-usage-heading">
      <div><span>TOKEN USAGE</span><h2>AI 用量明细</h2></div>
      <strong>${formatUsageCost(summary.totals)}</strong>
    </div>
    <div class="token-usage-summary">
      <span>总 Token ${formatTokens(summary.totals?.totalTokens)} · ${metricLine(summary.totals || {})}</span>
      <span>缓存输入 ${formatTokens(summary.totals?.cachedInputTokens)} · 推理 ${formatTokens(summary.totals?.reasoningTokens)}</span>
    </div>
    <div class="token-usage-categories">
      ${categories.map((category) => `
        <div class="token-usage-category">
          <div><strong>${escapeHtml(category.label)}</strong><span>${metricLine(category)}</span></div>
          <b>${formatUsageCost(category)}</b>
          <small>${formatTokens(category.totalTokens)} Token · Codex ${formatUsageCost(category.providers?.codex)} · API ${formatUsageCost(category.providers?.openai_api)}</small>
        </div>
      `).join("")}
    </div>
    <details class="token-usage-recent">
      <summary>最近任务（${recentTasks.length}）</summary>
      <div>
        ${recentTasks.length ? recentTasks.map((task) => `
          <p><span>${escapeHtml(task.categoryLabel)} · ${task.provider === "openai_api" ? "API" : "Codex"}</span><strong>${formatUsageCost(task)}</strong><small>${formatTokens(task.totalTokens)} Token · ${escapeHtml(task.taskId)}</small></p>
        `).join("") : "<em>尚无已报告的 Token 记录</em>"}
      </div>
    </details>
    <p class="token-usage-note">按 ${escapeHtml(summary.pricing?.checkedAt || "当前")} OpenAI API Standard 短上下文单价折算。API 项为 Token 费用估算；Codex 项仅是等价 API 参考成本，不代表订阅额外扣费。缓存 Token 已包含在输入中，推理 Token 已包含在输出中，不重复相加。Codex 未返回 usage 时不会估算。</p>
  `;
}

export function installTokenUsageWidget() {
  if (document.body.classList.contains("render-mode")) return null;
  const widget = document.createElement("div");
  widget.className = "token-usage-widget";
  widget.innerHTML = `
    <button class="token-usage-button" type="button" aria-expanded="false">
      <span>AI 用量</span><span class="token-usage-button-values"><strong>—</strong><small>— Token</small></span>
    </button>
    <div class="token-usage-popover" hidden><p class="token-usage-loading">正在读取用量…</p></div>
  `;
  document.body.append(widget);
  const button = widget.querySelector(".token-usage-button");
  const total = button.querySelector("strong");
  const tokenTotal = button.querySelector("small");
  const popover = widget.querySelector(".token-usage-popover");
  let stopped = false;

  const refresh = async () => {
    try {
      const response = await fetch("/api/usage", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const summary = await response.json();
      total.textContent = formatUsageCost(summary.totals);
      tokenTotal.textContent = `${formatTokens(summary.totals?.totalTokens)} Token`;
      renderDetails(popover, summary);
    } catch {
      total.textContent = "—";
      tokenTotal.textContent = "— Token";
      if (!popover.hidden) popover.innerHTML = '<p class="token-usage-loading">用量服务暂不可用</p>';
    }
  };

  button.addEventListener("click", () => {
    popover.hidden = !popover.hidden;
    button.setAttribute("aria-expanded", String(!popover.hidden));
    if (!popover.hidden) refresh();
  });
  document.addEventListener("pointerdown", (event) => {
    if (!popover.hidden && !widget.contains(event.target)) {
      popover.hidden = true;
      button.setAttribute("aria-expanded", "false");
    }
  });
  window.addEventListener("kitchen-token-usage-updated", refresh);
  const timer = window.setInterval(() => { if (!stopped) refresh(); }, 2500);
  window.addEventListener("pagehide", () => {
    stopped = true;
    window.clearInterval(timer);
  }, { once: true });
  refresh();
  return { refresh };
}
