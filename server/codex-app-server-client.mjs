import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

function resolveCodexExecutable(explicitExecutable) {
  if (explicitExecutable) return explicitExecutable;
  if (process.platform !== "win32") return "codex";

  const candidates = [];
  for (const entry of (process.env.PATH || "").split(path.delimiter)) {
    const directory = entry.trim().replace(/^"|"$/g, "");
    if (directory) candidates.push(path.join(directory, "codex.exe"));
  }

  const desktopBin = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "OpenAI", "Codex", "bin")
    : null;
  if (desktopBin && fs.existsSync(desktopBin)) {
    for (const entry of fs.readdirSync(desktopBin, { withFileTypes: true })) {
      if (entry.isDirectory()) candidates.push(path.join(desktopBin, entry.name, "codex.exe"));
    }
    candidates.push(path.join(desktopBin, "codex.exe"));
  }

  const existing = candidates
    .filter((candidate) => fs.existsSync(candidate))
    .map((candidate) => ({ candidate, modifiedAt: fs.statSync(candidate).mtimeMs }))
    .sort((left, right) => right.modifiedAt - left.modifiedAt);
  return existing[0]?.candidate || "codex";
}

export class CodexAppServerClient extends EventEmitter {
  constructor({ cwd, executable } = {}) {
    super();
    this.cwd = cwd;
    this.executable = resolveCodexExecutable(executable || process.env.CODEX_EXECUTABLE);
    this.process = null;
    this.nextRequestId = 1;
    this.pending = new Map();
    this.readyPromise = null;
  }

  async start() {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = this.#startProcess();
    return this.readyPromise;
  }

  async #startProcess() {
    this.process = spawn(this.executable, ["app-server", "--listen", "stdio://"], {
      cwd: this.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    this.process.once("error", (error) => {
      const detail = error.code === "ENOENT"
        ? `找不到 Codex 可执行文件：${this.executable}。请设置 CODEX_EXECUTABLE 为 codex.exe 的绝对路径。`
        : error.message;
      this.#failAll(new Error(detail));
      this.process = null;
      this.readyPromise = null;
    });
    this.process.once("exit", (code, signal) => {
      const detail = signal ? `signal ${signal}` : `exit code ${code}`;
      this.#failAll(new Error(`Codex app-server stopped (${detail}).`));
      this.emit("exit", { code, signal });
      this.process = null;
      this.readyPromise = null;
    });

    readline.createInterface({ input: this.process.stdout }).on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        this.#handleMessage(JSON.parse(trimmed));
      } catch (error) {
        this.emit("protocolError", new Error(`Invalid app-server message: ${error.message}`));
      }
    });

    readline.createInterface({ input: this.process.stderr }).on("line", (line) => {
      if (line.trim()) this.emit("log", line.trim());
    });

    await this.request("initialize", {
      clientInfo: {
        name: "kitchen_studio",
        title: "Kitchen Studio",
        version: "0.2.0",
      },
      capabilities: {
        experimentalApi: false,
        requestAttestation: false,
      },
    });
    this.notify("initialized");
  }

  request(method, params = {}) {
    if (!this.process?.stdin?.writable) {
      return Promise.reject(new Error("Codex app-server is not running."));
    }
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.#write({ method, id, params });
    });
  }

  notify(method, params) {
    const message = params === undefined ? { method } : { method, params };
    this.#write(message);
  }

  async startThread({ model, cwd, baseInstructions }) {
    await this.start();
    const result = await this.request("thread/start", {
      model,
      cwd,
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      baseInstructions,
      ephemeral: false,
    });
    return result.thread;
  }

  async startTurn({ threadId, text, imagePaths = [], model, effort = "high" }) {
    return this.request("turn/start", {
      threadId,
      input: [
        { type: "text", text, text_elements: [] },
        ...imagePaths.map((imagePath) => ({ type: "localImage", path: imagePath, detail: "high" })),
      ],
      model,
      effort,
      approvalPolicy: "never",
      sandboxPolicy: { type: "dangerFullAccess" },
    });
  }

  async setThreadName(threadId, name) {
    return this.request("thread/name/set", { threadId, name });
  }

  #write(message) {
    if (!this.process?.stdin?.writable) throw new Error("Codex app-server is not writable.");
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #handleMessage(message) {
    if (Object.hasOwn(message, "id")) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (message.method) this.emit("notification", message);
  }

  #failAll(error) {
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }
}
