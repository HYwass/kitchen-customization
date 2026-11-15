# Kitchen Studio

[中文](README.md) | [English](README.en.md)

Kitchen Studio 是一个本地运行的 AI 厨房定制原型系统。用户可以描述房间与设计偏好，或上传户型图、厨房多视角照片，得到可以继续编辑和导出的厨房场景。

## 功能

- 根据房间边界、门窗和偏好生成三套差异化厨房方案；
- 从户型图识别厨房边界和门窗；
- 从同一厨房的多视角照片重建可编辑场景；
- 在 Three.js 编辑器中增删、移动、旋转和替换厨房组件；
- 使用自然语言继续修改当前方案；
- 实时显示方案估价和各功能的 AI Token 用量；
- 导出场景 JSON、设计图纸和详细成本清单；
- 中英文界面一键切换，并在两个页面间保留语言选择。

AI 功能有两种接入方式：

| 方式 | 使用的额度 | 适合用户 |
| --- | --- | --- |
| Codex 模式 | 当前登录用户的 Codex / ChatGPT 方案额度 | 已安装并登录 Codex，希望快速本地运行 |
| OpenAI API 模式 | `OPENAI_API_KEY` 所属项目的 API 额度 | 希望独立 API 计费，不依赖本地 Codex 登录 |

两种方式共用同一套前端、组件库、场景格式、验证器和渲染器，只需配置其中一种。

## 环境要求

- Git；
- Node.js `20.19+` 或 `22.12+`，推荐当前 Node.js LTS；
- npm；
- 支持 WebGL2 且开启图形加速的现代浏览器；
- Codex 模式：本机已安装并登录 Codex；
- API 模式：OpenAI Platform API Key 和可用 API 额度。

先检查基础环境：

```powershell
git --version
node --version
npm --version
```

Node.js 版本过低时，请先升级，再安装项目依赖。

---

## 方式一：使用本机 Codex

以下以 Windows PowerShell 为例，请按顺序完成。

### 1. 安装并登录 Codex

Windows 用户推荐安装 Codex 桌面应用并完成登录；已经可以在终端运行的 Codex CLI 也可以使用。登录账户需要拥有可用的 Codex 权限和额度。

打开新的 PowerShell 窗口并检查：

```powershell
codex --version
```

能够返回版本号即可继续。如果命令不存在，请先安装 Codex，或在第 4 步显式指定 `codex.exe`。

### 2. 下载项目

```powershell
git clone https://github.com/HYwass/kitchen-customization.git
cd kitchen-customization
```

已有仓库时，在项目目录执行 `git pull` 更新。

### 3. 安装依赖

```powershell
npm install
```

通常只需在首次运行、依赖更新或切换 Node.js 版本后执行。

### 4. 确认项目能找到 Codex

```powershell
Get-Command codex
```

Windows 下项目依次查找：

1. `CODEX_EXECUTABLE` 指定的路径；
2. `PATH` 中的 `codex.exe`；
3. `%LOCALAPPDATA%\OpenAI\Codex\bin` 下由 Codex 桌面应用安装的 `codex.exe`。

自动查找失败时，先查找真实文件：

```powershell
Get-ChildItem "$env:LOCALAPPDATA\OpenAI\Codex\bin" -Recurse -Filter codex.exe
```

然后在当前终端中指定绝对路径：

```powershell
$env:CODEX_EXECUTABLE = "C:\完整路径\codex.exe"
```

### 5. 启动完整项目

```powershell
npm run studio
```

终端应显示两个服务：

- 前端：`http://127.0.0.1:5173`
- 本地 AI 任务服务：`http://127.0.0.1:8787`

保持终端开启；按 `Ctrl+C` 停止项目。

### 6. 生成并编辑方案

1. 打开 <http://127.0.0.1:5173/studio.html>；
2. 在右上角“AI 接入”中选择“Codex 订阅模式”；
3. 输入方案名称；
4. 绘制房间边界，或上传户型图识别厨房；
5. 填写门窗、布局、门板风格和其他需求；
6. 根据需要开启或关闭“执行完整 refine”；
7. 点击“生成三套方案”；
8. 比较方案，选择一个进入编辑器；
9. 手动编辑，或使用自然语言继续修改；
10. 保存 JSON，或导出图纸和成本清单。

Codex 默认配置：

```text
model: gpt-6-astra
reasoning effort: low
```

需要覆盖时，在启动项目的同一个终端中设置：

```powershell
$env:KITCHEN_CODEX_MODEL = "gpt-6-astra"
$env:KITCHEN_AI_EFFORT = "low"
npm run studio
```

模型能否使用取决于当前登录账户；实际成功完成一次请求才是最终权限验证。

---

## 方式二：使用 OpenAI API

API 模式不要求本机登录 Codex，但需要 OpenAI Platform API Key。API 用量与 ChatGPT/Codex 订阅分开计费。

### 1. 准备 OpenAI API

1. 登录 [OpenAI Platform](https://platform.openai.com/)；
2. 在项目中创建 API Key；
3. 确认项目已经配置可用额度或账单；
4. 复制并妥善保存 Key，不要提交到 GitHub。

参考：[OpenAI API 官方快速开始](https://developers.openai.com/api/docs/quickstart)。

### 2. 下载项目

```powershell
git clone https://github.com/HYwass/kitchen-customization.git
cd kitchen-customization
```

### 3. 安装依赖

```powershell
npm install
```

项目由本地服务直接调用 Responses API，不需要额外执行 `npm install openai`。

### 4. 在当前终端设置 API Key

PowerShell：

```powershell
$env:OPENAI_API_KEY = "sk-你的API-Key"
$env:KITCHEN_OPENAI_MODEL = "gpt-6-astra"
$env:KITCHEN_AI_EFFORT = "low"
```

macOS / Linux：

```bash
export OPENAI_API_KEY="sk-your-api-key"
export KITCHEN_OPENAI_MODEL="gpt-6-astra"
export KITCHEN_AI_EFFORT="low"
```

上述设置仅对当前终端生效，更安全且方便测试。不要把真实 Key 写入 README、源码或 `.env.example`。

### 5. 在同一个终端启动项目

```powershell
npm run studio
```

启动日志应包含：

```text
OpenAI API model: gpt-6-astra (configured)
```

如果显示 `OPENAI_API_KEY not set`，停止服务，在启动项目的同一个终端重新设置环境变量，然后再次启动。

### 6. 选择 API 模式并使用

1. 打开 <http://127.0.0.1:5173/studio.html>；
2. 在“AI 接入”中选择“OpenAI API 模式”；
3. 填写房间和设计需求；
4. 点击“生成三套方案”；
5. 等待 API 完成生成、核验、渲染和评价；
6. 选择方案进入编辑器；
7. 后续自然语言编辑会继续使用当前选择的 API 模式；
8. 在右下角“AI 用量”中查看各功能的 Token 和估算费用。

API Key 只由本地 Node 服务读取，不会发送到浏览器。本地 AI 工具会限制凭据读取、网络命令、删除操作和破坏性 Git 命令。本项目是本地单用户原型，请勿将 `8787` 端口或生成服务暴露到公网。

---

## 不使用 AI，只打开编辑器

```powershell
npm install
npm run dev
```

访问 <http://127.0.0.1:5173/>。可以导入、编辑和导出场景，但 AI 生成、户型图识别、图片重建和自然语言修改不可用。

## 页面与工作流程

### AI 工作台

访问 <http://127.0.0.1:5173/studio.html>：

- “需求生成”：根据房间信息生成三套方案；
- “图片重建”：上传同一厨房的多视角图片并输出一次重建结果；
- “从户型图识别”：提取厨房边界和门窗，由用户确认后生成方案。

### 场景编辑器

访问 <http://127.0.0.1:5173/>：

- 添加或替换柜体、门板、拉手、电器、桌椅和台面；
- 移动、旋转以及打开柜门和抽屉；
- 查看实时价格；
- 使用自然语言修改当前场景；
- 保存/载入场景 JSON；
- 导出俯视图、相关墙面立面图和成本清单。

两个页面右上角的 `English / 中文` 按钮共用同一语言设置。

## 生成文件

```text
generation/runs/                  三套方案生成记录
generation/editor_sessions/       编辑器自然语言修改记录
generation/reconstructions/       多视角图片重建记录
generation/floorplan_recognition/ 户型图识别记录
generation/token_usage/           Token 与费用统计
```

每轮生成会保留场景 JSON、核验结果、渲染图片和过程记录。这些目录已被 `.gitignore` 排除。

## 核心目录

```text
assets/       GLB 组件库和门窗模型
catalog/      柜体、门板、拉手、电器、家具、台面和价格定义
generation/   系统提示词、组件清单、场景 schema 和示例场景
scripts/      启动、核验、渲染、评价和方案比较脚本
server/       Codex app-server 与 OpenAI Responses API 接入
src/          AI 工作台和 Three.js 编辑器前端
```

## 常用命令

```powershell
npm run studio
npm run dev
npm run build
npm run validate:scene -- <scene.json>
npm run render:scene -- <scene.json>
npm run evaluate:functionality -- <final_scene.json>
```

## 常见问题

### `Cannot find native binding` 或缺少 `@rolldown/binding-win32-x64-msvc`

确认 Node.js 版本后重新安装依赖：

```powershell
Remove-Item -Recurse -Force node_modules
npm install
```

仍然失败时再删除锁文件：

```powershell
Remove-Item -Force package-lock.json
npm install
```

删除锁文件会重新解析依赖版本，仅在普通重装无效时使用。

### `spawn codex ENOENT` 或找不到 Codex

```powershell
codex --version
Get-Command codex
```

如果终端可运行 Codex 但项目仍找不到，请把 `CODEX_EXECUTABLE` 设置为真实 `codex.exe` 的绝对路径，并在同一终端重新运行 `npm run studio`。

### “OpenAI API 模式”不可选择

如果日志显示 `OPENAI_API_KEY not set`，停止项目，在当前终端设置 `$env:OPENAI_API_KEY` 后重新运行 `npm run studio`。只刷新浏览器不会让服务读取新的环境变量。

### `THREE.WebGLRenderer: Error creating WebGL context`

开启浏览器硬件加速，更新显卡驱动并重启浏览器。Chrome/Edge 可通过 `chrome://gpu` 或 `edge://gpu` 检查 WebGL 状态。

### 浏览器仍显示旧界面

使用 `Ctrl+F5` 强制刷新；仍未更新时，停止服务后重新运行 `npm run studio`。

### 生成时间较长

关闭“执行完整 refine”可以跳过反复渲染、视觉检查和迭代，减少时间和 Token。完整 refine 通常更稳定，但速度更慢。

## 数据、价格与安全说明

- 坐标系为 `X=宽、Y=深、Z=高`，正面为 `+Y`，向上为 `+Z`；
- 房间是逆时针正交多边形，并支持门窗和净空约束；
- 编辑器价格为人民币演示估价，不含安装、运输、税费和硬装工程；单价在 `catalog/pricing.json` 中调整；
- API 费用以 OpenAI 实际账单为准，界面显示的是 Token 估算；
- Codex 模式中的美元金额只是等价 API 参考，不表示订阅模式额外扣费；
- 服务默认只监听 `127.0.0.1`，不要直接暴露到公网；
- 不要把 API Key、登录凭据或隐私户型图提交到 Git。

## OpenAI 官方文档

- [OpenAI API 快速开始](https://developers.openai.com/api/docs/quickstart)
- [Codex app-server](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)
- [Codex 作为应用集成平台](https://developers.openai.com/blog/codex-as-a-platform)
