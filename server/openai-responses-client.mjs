import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const API_URL = "https://api.openai.com/v1/responses";
const MAX_TOOL_ROUNDS = 80;
const MAX_COMMAND_TIMEOUT_MS = 300_000;
const MAX_COMMAND_OUTPUT_BYTES = 1_000_000;

function imageMimeType(filePath) {
  return {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
  }[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function sanitizedEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => (
    !/(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name)
  )));
}

function blockedCommandReason(command) {
  const blocked = [
    [/\b(?:Remove-Item|rm|rmdir|del|erase|format)\b/i, "禁止删除或格式化文件"],
    [/\bgit\s+(?:reset|clean|checkout|restore)\b/i, "禁止执行破坏性 Git 命令"],
    [/\b(?:Invoke-WebRequest|Invoke-RestMethod|curl|wget|Start-BitsTransfer)\b/i, "禁止从本地 shell 访问网络"],
    [/\b(?:Start-Process|shutdown|Stop-Computer|Restart-Computer)\b/i, "禁止启动后台进程或控制系统"],
    [/(?:\.env\b|process\.env|Get-ChildItem\s+Env:|\$env:OPENAI)/i, "禁止读取凭据或环境变量"],
  ];
  return blocked.find(([pattern]) => pattern.test(command))?.[1] || null;
}

function commandShell() {
  return process.platform === "win32"
    ? { executable: "powershell.exe", args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"] }
    : { executable: "sh", args: ["-c"] };
}

function runCommand(command, { cwd, timeoutMs, maxOutputLength }) {
  const blockedReason = blockedCommandReason(command);
  if (blockedReason) {
    return Promise.resolve({
      stdout: "",
      stderr: `Command rejected by Kitchen Studio: ${blockedReason}.`,
      outcome: { type: "exit", exit_code: 126 },
    });
  }
  const shell = commandShell();
  const timeout = Math.max(1_000, Math.min(Number(timeoutMs) || 120_000, MAX_COMMAND_TIMEOUT_MS));
  const outputLimit = Math.max(4_096, Math.min(Number(maxOutputLength) || 65_536, MAX_COMMAND_OUTPUT_BYTES));
  return new Promise((resolve) => {
    const child = spawn(shell.executable, [...shell.args, command], {
      cwd,
      env: sanitizedEnvironment(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let outputLimited = false;
    const append = (target, chunk) => {
      const next = target + chunk.toString("utf8");
      if (Buffer.byteLength(next, "utf8") > outputLimit) {
        outputLimited = true;
        return next.slice(0, outputLimit);
      }
      return next;
    };
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
    child.on("error", (error) => { stderr = append(stderr, error.message); });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeout);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (outputLimited) stderr = append(stderr, "\nOutput truncated by Kitchen Studio.");
      resolve({
        stdout,
        stderr,
        outcome: timedOut ? { type: "timeout" } : { type: "exit", exit_code: code ?? 1 },
      });
    });
  });
}

function outputText(response) {
  if (typeof response.output_text === "string") return response.output_text;
  return (response.output || []).flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text || "")
    .join("");
}

function collectStringValues(value, result = []) {
  if (typeof value === "string") result.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStringValues(item, result));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectStringValues(item, result));
  return result;
}

function renderedImagesFromOutputs(outputs, cwd, seen) {
  const candidates = [];
  for (const output of outputs) {
    try {
      candidates.push(...collectStringValues(JSON.parse(output.stdout)));
    } catch {
      candidates.push(...String(output.stdout || "").match(/[A-Za-z]:\\[^\r\n"]+\.png|\/[^\x00\r\n"]+\.png/g) || []);
    }
  }
  return candidates.map((candidate) => path.resolve(candidate))
    .filter((candidate) => {
      const relative = path.relative(cwd, candidate);
      return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
        && ["top.png", "perspective.png"].includes(path.basename(candidate).toLowerCase())
        && fs.existsSync(candidate) && !seen.has(candidate);
    })
    .map((candidate) => {
      seen.add(candidate);
      return {
        type: "input_image",
        image_url: `data:${imageMimeType(candidate)};base64,${fs.readFileSync(candidate).toString("base64")}`,
        detail: "high",
      };
    });
}

export class OpenAIResponsesClient extends EventEmitter {
  constructor({ cwd, apiKey, model, effort = "low" } = {}) {
    super();
    this.cwd = cwd;
    this.apiKey = apiKey;
    this.model = model;
    this.effort = effort;
    this.threads = new Map();
  }

  get available() {
    return Boolean(this.apiKey);
  }

  async startThread({ model, cwd, baseInstructions }) {
    if (!this.apiKey) throw new Error("未配置 OPENAI_API_KEY，无法使用 OpenAI API 模式。");
    const id = `api_${crypto.randomUUID()}`;
    this.threads.set(id, {
      id,
      model: model || this.model,
      cwd: cwd || this.cwd,
      baseInstructions,
      previousResponseId: null,
      name: null,
    });
    return { id };
  }

  async startTurn({ threadId, text, imagePaths = [], model, effort }) {
    const thread = this.threads.get(threadId);
    if (!thread) throw new Error(`OpenAI API 会话不存在：${threadId}`);
    const turn = { id: `turn_${crypto.randomUUID()}` };
    queueMicrotask(() => this.#runTurn(thread, turn, { text, imagePaths, model, effort }).catch((error) => {
      this.emit("notification", {
        method: "turn/completed",
        params: { threadId, turn: { ...turn, status: "failed", error: { message: error.message } } },
      });
    }));
    return { turn };
  }

  async setThreadName(threadId, name) {
    const thread = this.threads.get(threadId);
    if (thread) thread.name = name;
  }

  async #request(body) {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error?.message || `OpenAI Responses API 请求失败：HTTP ${response.status}`);
    }
    if (["failed", "incomplete"].includes(payload.status)) {
      throw new Error(payload.error?.message || payload.incomplete_details?.reason || `OpenAI Responses API 返回状态：${payload.status}`);
    }
    return payload;
  }

  async #runTurn(thread, turn, { text, imagePaths, model, effort }) {
    const threadId = thread.id;
    const reportUsage = (response) => {
      if (!response?.usage) return;
      this.emit("notification", {
        method: "usage/updated",
        params: {
          threadId,
          turnId: turn.id,
          responseId: response.id,
          usage: response.usage,
        },
      });
    };
    this.emit("notification", { method: "turn/started", params: { threadId, turn } });
    const content = [{ type: "input_text", text }];
    for (const imagePath of imagePaths) {
      const bytes = fs.readFileSync(imagePath);
      content.push({
        type: "input_image",
        image_url: `data:${imageMimeType(imagePath)};base64,${bytes.toString("base64")}`,
        detail: "high",
      });
    }
    const tools = [{ type: "shell", environment: { type: "local" } }];
    const common = {
      model: model || thread.model || this.model,
      instructions: `${thread.baseInstructions}\nThe local shell is ${process.platform === "win32" ? "Windows PowerShell" : "POSIX sh"}. Work only inside ${thread.cwd}. The Codex apply_patch tool is not available in API mode; use Node.js fs.readFileSync and fs.writeFileSync with UTF-8 when reading or writing required JSON artifacts. Never read environment variables or credentials, access the network, delete files, change Git state, or modify source/catalog files. Use non-interactive commands only. Rendered top.png and perspective.png files will be attached automatically after the render command; inspect both images before refining.`,
      tools,
      reasoning: { effort: effort || this.effort },
    };
    const attachedRenderedImages = new Set();
    let response = await this.#request({
      ...common,
      input: [{ type: "message", role: "user", content }],
      ...(thread.previousResponseId ? { previous_response_id: thread.previousResponseId } : {}),
    });
    reportUsage(response);

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const calls = (response.output || []).filter((item) => item.type === "shell_call");
      if (!calls.length) {
        thread.previousResponseId = response.id;
        const finalText = outputText(response).trim();
        if (finalText) {
          this.emit("notification", { method: "item/agentMessage/delta", params: { threadId, delta: finalText } });
        }
        this.emit("notification", {
          method: "turn/completed",
          params: { threadId, turn: { ...turn, status: "completed" } },
        });
        return;
      }

      const toolOutputs = [];
      const renderedImages = [];
      for (const call of calls) {
        this.emit("notification", {
          method: "item/started",
          params: { threadId, item: { type: "commandExecution", command: call.action?.commands?.join(" && ") || "" } },
        });
        const commandOutputs = [];
        for (const command of call.action?.commands || []) {
          commandOutputs.push(await runCommand(command, {
            cwd: thread.cwd,
            timeoutMs: call.action?.timeout_ms,
            maxOutputLength: call.action?.max_output_length,
          }));
        }
        renderedImages.push(...renderedImagesFromOutputs(commandOutputs, thread.cwd, attachedRenderedImages));
        toolOutputs.push({
          type: "shell_call_output",
          call_id: call.call_id,
          max_output_length: call.action?.max_output_length || 65_536,
          output: commandOutputs,
        });
        const failed = commandOutputs.some((item) => item.outcome.type === "timeout" || item.outcome.exit_code !== 0);
        this.emit("notification", {
          method: "item/completed",
          params: { threadId, item: { type: "commandExecution", exitCode: failed ? 1 : 0 } },
        });
      }
      response = await this.#request({
        ...common,
        previous_response_id: response.id,
        input: renderedImages.length ? [
          ...toolOutputs,
          {
            type: "message",
            role: "user",
            content: [
              { type: "input_text", text: "The following images are the newly rendered Kitchen Studio top and perspective views. Inspect them as required by the workflow." },
              ...renderedImages,
            ],
          },
        ] : toolOutputs,
      });
      reportUsage(response);
    }
    throw new Error(`OpenAI API 本地工具调用超过 ${MAX_TOOL_ROUNDS} 轮，任务已终止。`);
  }
}
