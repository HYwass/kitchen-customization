import "./studio.css";

const PROFILES = [
  { id: "function_rich", label: "功能丰富", icon: "◆", summary: "更完整的电器、储物和操作功能" },
  { id: "space_efficient", label: "空间利用", icon: "▦", summary: "更高的墙面利用率和连续工作台" },
  { id: "spacious", label: "宽敞通透", icon: "◇", summary: "完整基础功能与更大的活动空间" },
];

const dom = {
  serviceStatus: document.querySelector("#service-status"),
  workflowTabs: document.querySelector("#workflow-tabs"),
  designMode: document.querySelector("#design-mode-button"),
  reconstructionMode: document.querySelector("#reconstruction-mode-button"),
  requestView: document.querySelector("#request-view"),
  progressView: document.querySelector("#progress-view"),
  comparisonView: document.querySelector("#comparison-view"),
  reconstructionRequestView: document.querySelector("#reconstruction-request-view"),
  reconstructionProgressView: document.querySelector("#reconstruction-progress-view"),
  reconstructionResultView: document.querySelector("#reconstruction-result-view"),
  form: document.querySelector("#design-form"),
  name: document.querySelector("#design-name"),
  roomOutline: document.querySelector("#room-outline"),
  openings: document.querySelector("#openings"),
  layout: document.querySelector("#layout-preference"),
  style: document.querySelector("#style-preference"),
  extra: document.querySelector("#extra-requirements"),
  fullRefine: document.querySelector("#full-refine"),
  progressStage: document.querySelector("#progress-stage"),
  profileProgress: document.querySelector("#profile-progress"),
  runIdLabel: document.querySelector("#run-id-label"),
  activityLog: document.querySelector("#activity-log"),
  planGrid: document.querySelector("#plan-grid"),
  newDesign: document.querySelector("#new-design-button"),
  reconstructionForm: document.querySelector("#reconstruction-form"),
  reconstructionName: document.querySelector("#reconstruction-name"),
  reconstructionImages: document.querySelector("#reconstruction-images"),
  reconstructionPreview: document.querySelector("#reconstruction-preview"),
  reconstructionNotes: document.querySelector("#reconstruction-notes"),
  reconstructionProgressStage: document.querySelector("#reconstruction-progress-stage"),
  reconstructionImageCount: document.querySelector("#reconstruction-image-count"),
  reconstructionIdLabel: document.querySelector("#reconstruction-id-label"),
  reconstructionActivityLog: document.querySelector("#reconstruction-activity-log"),
  reconstructionOpenEditor: document.querySelector("#reconstruction-open-editor"),
  reconstructionDownloadJson: document.querySelector("#reconstruction-download-json"),
  newReconstruction: document.querySelector("#new-reconstruction-button"),
  toast: document.querySelector("#studio-toast"),
};

const initialParameters = new URLSearchParams(window.location.search);
let currentRunId = initialParameters.get("run");
let currentReconstructionId = initialParameters.get("reconstruction");
let eventSource = null;
let reconstructionPreviewUrls = [];
const reconstructionConversationStorageKey = "kitchen-reconstruction-conversation";
let reconstructionConversationKey = readSessionStorage(reconstructionConversationStorageKey);
if (!reconstructionConversationKey) {
  reconstructionConversationKey = `reconstruction:${createLocalId()}`;
  writeSessionStorage(reconstructionConversationStorageKey, reconstructionConversationKey);
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
    // Reconstruction still works without persistent browser session storage.
  }
}

function createLocalId() {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

renderProfileProgress();
checkService();
if (currentReconstructionId) restoreReconstruction(currentReconstructionId);
else if (currentRunId) restoreRun(currentRunId);

dom.form.addEventListener("submit", submitDesign);
dom.reconstructionForm.addEventListener("submit", submitReconstruction);
dom.reconstructionImages.addEventListener("change", renderReconstructionImages);
dom.designMode.addEventListener("click", () => switchRequestMode("design"));
dom.reconstructionMode.addEventListener("click", () => switchRequestMode("reconstruction"));
dom.newDesign.addEventListener("click", () => {
  history.pushState({}, "", "/studio.html");
  currentRunId = null;
  switchRequestMode("design");
  showView("request");
});
dom.newReconstruction.addEventListener("click", () => {
  history.pushState({}, "", "/studio.html");
  currentReconstructionId = null;
  dom.reconstructionForm.reset();
  dom.reconstructionName.value = "multiview_kitchen";
  clearReconstructionPreviews();
  switchRequestMode("reconstruction");
});

async function checkService() {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    if (!response.ok) throw new Error();
    const health = await response.json();
    dom.serviceStatus.classList.add("online");
    dom.serviceStatus.innerHTML = `<span></span>生成服务已连接 · ${escapeHtml(health.model)}`;
  } catch {
    dom.serviceStatus.classList.remove("online");
    dom.serviceStatus.innerHTML = "<span></span>生成服务未启动";
  }
}

function buildRequest() {
  return [
    `房间边界：${dom.roomOutline.value.trim()}`,
    "层高：2.7 m",
    `门窗与固定条件：${dom.openings.value.trim() || "没有额外信息；openings 为空数组"}`,
    `布局偏好：${dom.layout.value}`,
    `风格偏好：${dom.style.value}`,
    "基础功能：必须包含水槽、水龙头、灶台、油烟机和烤箱；空间允许时加入冰箱和洗碗机。",
    `其他要求：${dom.extra.value.trim() || "无"}`,
  ].join("\n");
}

async function submitDesign(event) {
  event.preventDefault();
  const submit = dom.form.querySelector("button[type=submit]");
  submit.disabled = true;
  try {
    validateOutline(dom.roomOutline.value);
    const response = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: dom.name.value,
        request: buildRequest(),
        fullRefine: dom.fullRefine.checked,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "无法创建生成任务");
    currentRunId = result.id;
    history.pushState({}, "", `/studio.html?run=${encodeURIComponent(currentRunId)}`);
    startProgress(result);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    submit.disabled = false;
  }
}

function switchRequestMode(mode) {
  const reconstruction = mode === "reconstruction";
  dom.designMode.classList.toggle("active", !reconstruction);
  dom.reconstructionMode.classList.toggle("active", reconstruction);
  showView(reconstruction ? "reconstructionRequest" : "request");
}

function clearReconstructionPreviews() {
  for (const url of reconstructionPreviewUrls) URL.revokeObjectURL(url);
  reconstructionPreviewUrls = [];
  dom.reconstructionPreview.innerHTML = "<p>尚未选择图片</p>";
}

function renderReconstructionImages() {
  clearReconstructionPreviews();
  const files = [...dom.reconstructionImages.files];
  if (!files.length) return;
  dom.reconstructionPreview.innerHTML = files.map((file, index) => {
    const url = URL.createObjectURL(file);
    reconstructionPreviewUrls.push(url);
    return `<div class="reconstruction-thumb"><img src="${url}" alt="视角 ${index + 1}" /><span>${index + 1}</span></div>`;
  }).join("");
}

async function submitReconstruction(event) {
  event.preventDefault();
  const files = [...dom.reconstructionImages.files];
  if (!files.length) {
    showToast("请至少选择一张厨房图片。", true);
    return;
  }
  const submit = dom.reconstructionForm.querySelector("button[type=submit]");
  submit.disabled = true;
  showView("reconstructionProgress");
  dom.reconstructionImageCount.textContent = `${files.length} 张图片`;
  dom.reconstructionActivityLog.innerHTML = "";
  try {
    const createResponse = await fetch("/api/reconstructions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: dom.reconstructionName.value }),
    });
    const created = await createResponse.json();
    if (!createResponse.ok) throw new Error(created.error || "无法创建图片重建任务");
    currentReconstructionId = created.id;
    dom.reconstructionIdLabel.textContent = created.id;
    history.pushState({}, "", `/studio.html?reconstruction=${encodeURIComponent(created.id)}`);

    for (const [index, file] of files.entries()) {
      dom.reconstructionProgressStage.textContent = `正在上传图片 ${index + 1} / ${files.length}`;
      appendReconstructionEvent({
        at: new Date().toISOString(),
        type: "progress",
        message: `正在上传：${file.name}`,
      });
      const uploadResponse = await fetch(
        `/api/reconstructions/${encodeURIComponent(created.id)}/images/${index + 1}?name=${encodeURIComponent(file.name)}`,
        { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file },
      );
      const uploadResult = await uploadResponse.json();
      if (!uploadResponse.ok) throw new Error(uploadResult.error || `图片 ${file.name} 上传失败`);
    }

    dom.reconstructionProgressStage.textContent = "图片已上传，正在启动 Codex";
    const startResponse = await fetch(`/api/reconstructions/${encodeURIComponent(created.id)}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: dom.reconstructionName.value,
        notes: dom.reconstructionNotes.value,
        conversationKey: reconstructionConversationKey,
      }),
    });
    const task = await startResponse.json();
    if (!startResponse.ok) throw new Error(task.error || "无法启动图片重建任务");
    followReconstructionTask(task);
  } catch (error) {
    dom.reconstructionProgressStage.textContent = `重建失败：${error.message}`;
    appendReconstructionEvent({ at: new Date().toISOString(), type: "failed", message: error.message }, true);
    showToast(error.message, true);
  } finally {
    submit.disabled = false;
  }
}

function validateOutline(text) {
  let outline;
  try {
    outline = JSON.parse(text);
  } catch {
    throw new Error("房间边界必须是合法的 JSON 坐标数组。");
  }
  if (!Array.isArray(outline) || outline.length < 4 || outline.some((point) => !Array.isArray(point) || point.length !== 2 || point.some((value) => !Number.isFinite(value)))) {
    throw new Error("房间边界至少需要四个有效的 [x, y] 顶点。");
  }
}

async function restoreRun(runId) {
  try {
    const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`, { cache: "no-store" });
    const task = await response.json();
    if (!response.ok) throw new Error(task.error || "找不到该生成任务");
    if (task.status === "completed") await showComparison();
    else startProgress(task);
  } catch (error) {
    history.replaceState({}, "", "/studio.html");
    currentRunId = null;
    showToast(error.message, true);
  }
}

async function restoreReconstruction(reconstructionId) {
  try {
    const response = await fetch(`/api/reconstructions/${encodeURIComponent(reconstructionId)}`, { cache: "no-store" });
    const task = await response.json();
    if (!response.ok) throw new Error(task.error || "找不到该图片重建任务");
    if (task.status === "completed") await showReconstructionResult(reconstructionId);
    else if (["queued", "starting", "running"].includes(task.status)) followReconstructionTask(task);
    else throw new Error(task.error || "该重建任务尚未完成，且无法从当前服务进程恢复。");
  } catch (error) {
    history.replaceState({}, "", "/studio.html");
    currentReconstructionId = null;
    switchRequestMode("reconstruction");
    showToast(error.message, true);
  }
}

function followReconstructionTask(task) {
  showView("reconstructionProgress");
  currentReconstructionId = task.id;
  dom.reconstructionIdLabel.textContent = task.id;
  if (Number.isFinite(task.imageCount)) dom.reconstructionImageCount.textContent = `${task.imageCount} 张图片`;
  updateReconstructionProgress(task);
  eventSource?.close();
  eventSource = new EventSource(`/api/reconstructions/${encodeURIComponent(task.id)}/events`);
  eventSource.addEventListener("snapshot", async (event) => {
    const snapshot = JSON.parse(event.data);
    updateReconstructionProgress(snapshot);
    if (snapshot.status === "completed") {
      eventSource.close();
      await showReconstructionResult(task.id);
    }
  });
  for (const eventName of ["status", "progress", "agent", "system"]) {
    eventSource.addEventListener(eventName, (event) => appendReconstructionEvent(JSON.parse(event.data)));
  }
  eventSource.addEventListener("completed", async (event) => {
    appendReconstructionEvent(JSON.parse(event.data));
    eventSource.close();
    await showReconstructionResult(task.id);
  });
  eventSource.addEventListener("failed", (event) => {
    const detail = JSON.parse(event.data);
    appendReconstructionEvent(detail, true);
    eventSource.close();
    dom.reconstructionProgressStage.textContent = `重建失败：${detail.message}`;
  });
}

function updateReconstructionProgress(task) {
  dom.reconstructionProgressStage.textContent = task.stage || "正在重建";
  dom.reconstructionActivityLog.innerHTML = "";
  for (const event of task.messages || []) appendReconstructionEvent(event, event.type === "failed");
}

function appendReconstructionEvent(event, isError = false) {
  if (event.type === "agent" && event.message.length < 2) return;
  const row = document.createElement("div");
  row.className = `activity-row${isError ? " error" : ""}`;
  const time = new Date(event.at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  row.innerHTML = `<time>${time}</time><span>${escapeHtml(event.message)}</span>`;
  dom.reconstructionActivityLog.append(row);
  dom.reconstructionActivityLog.scrollTop = dom.reconstructionActivityLog.scrollHeight;
  dom.reconstructionProgressStage.textContent = event.message;
}

async function showReconstructionResult(reconstructionId) {
  const response = await fetch(`/api/reconstructions/${encodeURIComponent(reconstructionId)}`, { cache: "no-store" });
  const result = await response.json();
  if (!response.ok || !result.sceneUrl) throw new Error(result.error || "重建结果缺少场景 JSON");
  showView("reconstructionResult");
  dom.reconstructionOpenEditor.href = `/?scene=${encodeURIComponent(result.sceneUrl)}&reconstruction=${encodeURIComponent(reconstructionId)}`;
  dom.reconstructionDownloadJson.href = result.sceneUrl;
}

function startProgress(task) {
  showView("progress");
  dom.runIdLabel.textContent = task.id;
  updateProgress(task);
  eventSource?.close();
  eventSource = new EventSource(`/api/runs/${encodeURIComponent(task.id)}/events`);
  eventSource.addEventListener("snapshot", async (event) => {
    const snapshot = JSON.parse(event.data);
    updateProgress(snapshot);
    if (snapshot.status === "completed") {
      eventSource.close();
      await showComparison();
    }
  });
  for (const eventName of ["status", "progress", "agent", "system"]) {
    eventSource.addEventListener(eventName, (event) => appendEvent(JSON.parse(event.data)));
  }
  eventSource.addEventListener("completed", async (event) => {
    appendEvent(JSON.parse(event.data));
    eventSource.close();
    await showComparison();
  });
  eventSource.addEventListener("failed", (event) => {
    const detail = JSON.parse(event.data);
    appendEvent(detail, true);
    eventSource.close();
    dom.progressStage.textContent = `生成失败：${detail.message}`;
  });
}

function updateProgress(task) {
  dom.progressStage.textContent = task.stage || "正在生成";
  dom.activityLog.innerHTML = "";
  for (const event of task.messages || []) appendEvent(event, event.type === "failed");
}

function appendEvent(event, isError = false) {
  if (event.type === "agent" && event.message.length < 2) return;
  const row = document.createElement("div");
  row.className = `activity-row${isError ? " error" : ""}`;
  const time = new Date(event.at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  row.innerHTML = `<time>${time}</time><span>${escapeHtml(event.message)}</span>`;
  dom.activityLog.append(row);
  dom.activityLog.scrollTop = dom.activityLog.scrollHeight;
  dom.progressStage.textContent = event.message;
}

async function showComparison() {
  const response = await fetch(`/api/runs/${encodeURIComponent(currentRunId)}/plans`, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "无法读取方案结果");
  showView("comparison");
  renderPlans(data.plans);
}

function renderPlans(plans) {
  dom.planGrid.innerHTML = plans.map((plan, index) => {
    const preview = plan.perspectiveUrl
      ? `<img src="${plan.perspectiveUrl}" alt="${escapeHtml(plan.label)}透视图" />`
      : `<div class="missing-preview">暂无渲染图</div>`;
    const dimensions = (plan.dimensions || []).slice(0, 7).map((dimension) => `
      <div class="dimension-row"><span>${escapeHtml(dimension.label)}</span><div><i style="width:${Math.max(0, dimension.score || 0)}%"></i></div><strong>${formatScore(dimension.score)}</strong></div>
    `).join("");
    const strengths = (plan.strengths || []).slice(0, 2).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
    return `
      <article class="plan-card${index === 0 ? " featured" : ""}">
        <div class="plan-preview">${preview}<span class="plan-index">0${index + 1}</span></div>
        <div class="plan-body">
          <div class="plan-title-row"><div><span>${escapeHtml(plan.id)}</span><h2>${escapeHtml(plan.label)}</h2></div><div class="score"><strong>${formatScore(plan.score)}</strong><small>${escapeHtml(plan.scoreLabel)}</small></div></div>
          <p class="plan-summary">${escapeHtml(plan.summary || "")}</p>
          <div class="dimension-list">${dimensions || "<p>暂无分项评价</p>"}</div>
          ${strengths ? `<ul class="strength-list">${strengths}</ul>` : ""}
          <div class="plan-actions">
            ${plan.topUrl ? `<a class="studio-button secondary" href="${plan.topUrl}" target="_blank">查看顶视图</a>` : ""}
            <a class="studio-button primary" href="/?scene=${encodeURIComponent(plan.sceneUrl)}&run=${encodeURIComponent(currentRunId)}&plan=${encodeURIComponent(plan.id)}">选择并编辑</a>
          </div>
        </div>
      </article>`;
  }).join("");
}

function renderProfileProgress() {
  dom.profileProgress.innerHTML = PROFILES.map((profile) => `
    <article><span class="profile-icon">${profile.icon}</span><div><h2>${profile.label}</h2><p>${profile.summary}</p></div><span class="pulse-dot"></span></article>
  `).join("");
}

function showView(name) {
  dom.requestView.classList.toggle("hidden", name !== "request");
  dom.progressView.classList.toggle("hidden", name !== "progress");
  dom.comparisonView.classList.toggle("hidden", name !== "comparison");
  dom.reconstructionRequestView.classList.toggle("hidden", name !== "reconstructionRequest");
  dom.reconstructionProgressView.classList.toggle("hidden", name !== "reconstructionProgress");
  dom.reconstructionResultView.classList.toggle("hidden", name !== "reconstructionResult");
  dom.workflowTabs.classList.toggle("hidden", !["request", "reconstructionRequest"].includes(name));
}

function formatScore(value) {
  return Number.isFinite(value) ? Math.round(value) : "—";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
}

let toastTimer;
function showToast(message, error = false) {
  clearTimeout(toastTimer);
  dom.toast.textContent = message;
  dom.toast.className = `studio-toast visible${error ? " error" : ""}`;
  toastTimer = setTimeout(() => dom.toast.classList.remove("visible"), 4200);
}
