import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const STARTUP_TIMEOUT_MS = 30_000;
const RENDER_TIMEOUT_MS = 45_000;

function parseArguments(values) {
  const options = {
    scene: values[0],
    outputDirectory: null,
    browserPath: process.env.KITCHEN_BROWSER_PATH ?? null,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
  };
  for (let index = 1; index < values.length; index += 1) {
    const argument = values[index];
    const value = values[index + 1];
    if (value === undefined) throw new Error(`${argument} 缺少参数值`);
    if (argument === "--output-dir") options.outputDirectory = value;
    else if (argument === "--browser") options.browserPath = value;
    else if (argument === "--width") options.width = Number(value);
    else if (argument === "--height") options.height = Number(value);
    else throw new Error(`未知参数：${argument}`);
    index += 1;
  }
  if (!options.scene) throw new Error("缺少场景 JSON 路径");
  if (!Number.isInteger(options.width) || options.width < 320) throw new Error("--width 必须是不小于 320 的整数");
  if (!Number.isInteger(options.height) || options.height < 240) throw new Error("--height 必须是不小于 240 的整数");
  return options;
}

function findBrowser(explicitPath) {
  if (explicitPath && !fs.existsSync(explicitPath)) throw new Error(`指定的浏览器不存在：${explicitPath}`);
  const candidates = [
    explicitPath,
    process.platform === "win32" ? path.join(process.env.PROGRAMFILES ?? "", "Google", "Chrome", "Application", "chrome.exe") : null,
    process.platform === "win32" ? path.join(process.env["PROGRAMFILES(X86)"] ?? "", "Google", "Chrome", "Application", "chrome.exe") : null,
    process.platform === "win32" ? path.join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe") : null,
    process.platform === "win32" ? path.join(process.env.PROGRAMFILES ?? "", "Microsoft", "Edge", "Application", "msedge.exe") : null,
    process.platform === "win32" ? path.join(process.env["PROGRAMFILES(X86)"] ?? "", "Microsoft", "Edge", "Application", "msedge.exe") : null,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/microsoft-edge",
    "/usr/bin/chromium",
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error("未找到 Chrome 或 Edge；可用 --browser <路径> 或 KITCHEN_BROWSER_PATH 指定浏览器");
  }
  return found;
}

function ensureInsideProject(filePath, label) {
  const resolved = path.resolve(projectRoot, filePath);
  const relative = path.relative(projectRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`${label}必须位于项目目录内`);
  return resolved;
}

async function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`等待服务超时：${lastError?.message ?? url}`);
}

function spawnHidden(command, args, options = {}) {
  return spawn(command, args, {
    cwd: projectRoot,
    stdio: "ignore",
    windowsHide: true,
    ...options,
  });
}

class CdpClient {
  constructor(webSocketUrl) {
    this.socket = new WebSocket(webSocketUrl);
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", () => reject(new Error("无法连接浏览器调试接口")), { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

async function findPageTarget(debugPort, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page");
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      // Browser startup is still in progress.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("等待浏览器调试页面超时");
}

async function waitForRender(client, expectedView) {
  const deadline = Date.now() + RENDER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await client.send("Runtime.evaluate", {
      expression: "({ status: window.__KITCHEN_RENDER_STATUS__, error: window.__KITCHEN_RENDER_ERROR__, view: window.__KITCHEN_RENDER_VIEW__ })",
      returnByValue: true,
    });
    const state = result.result?.value;
    if (state?.status === "ready" && state.view === expectedView) return;
    if (state?.status === "error") throw new Error(`编辑器渲染失败：${state.error}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("等待场景模型载入超时");
}

async function navigateAndCapture(client, url, view, outputPath) {
  await client.send("Page.navigate", { url });
  await waitForRender(client, view);
  await client.send("Runtime.evaluate", {
    expression: "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    awaitPromise: true,
  });
  const screenshot = await client.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  fs.writeFileSync(outputPath, Buffer.from(screenshot.data, "base64"));
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2_000))]);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const scenePath = ensureInsideProject(options.scene, "场景 JSON ");
  if (!fs.existsSync(scenePath) || path.extname(scenePath).toLowerCase() !== ".json") {
    throw new Error(`场景 JSON 不存在：${scenePath}`);
  }
  JSON.parse(fs.readFileSync(scenePath, "utf8"));
  const browserPath = findBrowser(options.browserPath);
  const sceneName = path.basename(scenePath, path.extname(scenePath));
  const outputDirectory = options.outputDirectory
    ? ensureInsideProject(options.outputDirectory, "输出目录 ")
    : path.join(path.dirname(scenePath), `${sceneName}_renders`);
  fs.mkdirSync(outputDirectory, { recursive: true });

  const relativeScenePath = path.relative(projectRoot, scenePath).split(path.sep).map(encodeURIComponent).join("/");
  const vitePort = await reservePort();
  const debugPort = await reservePort();
  const viteEntry = path.join(projectRoot, "node_modules", "vite", "bin", "vite.js");
  if (!fs.existsSync(viteEntry)) throw new Error("缺少 Vite，请先在项目目录执行 npm install");
  const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kitchen-render-"));
  let viteProcess;
  let browserProcess;

  try {
    viteProcess = spawnHidden(process.execPath, [viteEntry, "--host", "127.0.0.1", "--port", String(vitePort), "--strictPort"]);
    await waitForHttp(`http://127.0.0.1:${vitePort}/`, STARTUP_TIMEOUT_MS);

    browserProcess = spawnHidden(browserPath, [
      "--headless=new",
      "--disable-extensions",
      "--enable-webgl",
      "--hide-scrollbars",
      "--ignore-gpu-blocklist",
      "--no-first-run",
      "--no-default-browser-check",
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profileRoot}`,
      `--window-size=${options.width},${options.height}`,
      "about:blank",
    ]);
    const target = await findPageTarget(debugPort, STARTUP_TIMEOUT_MS);
    const client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    await client.send("Page.enable");
    await client.send("Runtime.enable");

    const baseUrl = `http://127.0.0.1:${vitePort}/?render=1&scene=${encodeURIComponent(`/${relativeScenePath}`)}`;
    const outputs = {
      top: path.join(outputDirectory, "top.png"),
      perspective: path.join(outputDirectory, "perspective.png"),
    };
    await navigateAndCapture(client, `${baseUrl}&view=top`, "top", outputs.top);
    await navigateAndCapture(client, `${baseUrl}&view=perspective`, "perspective", outputs.perspective);
    client.close();

    process.stdout.write(`${JSON.stringify({
      scene: scenePath,
      width: options.width,
      height: options.height,
      images: outputs,
    }, null, 2)}\n`);
  } finally {
    await stopProcess(browserProcess);
    await stopProcess(viteProcess);
    const temporaryBase = path.resolve(os.tmpdir());
    const resolvedProfile = path.resolve(profileRoot);
    if (resolvedProfile.startsWith(`${temporaryBase}${path.sep}`) && path.basename(resolvedProfile).startsWith("kitchen-render-")) {
      try {
        fs.rmSync(resolvedProfile, { recursive: true, force: true });
      } catch {
        // A browser subprocess may briefly retain a profile file on Windows.
      }
    }
  }
}

main().catch((error) => {
  console.error(`Render failed: ${error.message}`);
  process.exitCode = 1;
});
