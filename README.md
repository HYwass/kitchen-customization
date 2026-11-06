# Kitchen Studio

Kitchen Studio 是一个本地运行的 AI 厨房定制原型系统，集成了三条工作路径：

- 根据房间边界、门窗和用户偏好生成三套差异化厨房方案；
- 根据同一厨房的多视角图片重建可编辑场景；
- 在 Three.js 编辑器中手动调整或通过自然语言继续修改方案，并导出场景 JSON 和图纸。

AI 功能通过用户本机已经登录的 Codex `app-server` 运行，不需要在浏览器中填写 API Key。组件目录、场景 schema、验证器、渲染器和功能性评价器均包含在仓库中。

## 环境要求

- Node.js 20.19+ 或 22.12+；
- npm；
- 已安装并登录 Codex，终端中能够运行 `codex --version`；
- 支持 WebGL2 的现代浏览器，并开启浏览器图形加速。

## 安装与启动

```powershell
npm install
npm run studio
```

启动后访问：

- AI 方案生成与图片重建：<http://127.0.0.1:5173/studio.html>
- 厨房场景编辑器：<http://127.0.0.1:5173/>

`npm run studio` 会同时启动 Vite 前端和本地生成服务。只需要使用编辑器、不需要 AI 功能时，也可以执行 `npm run dev`。

## Codex 配置

默认模型为 `gpt-6-astra`，reasoning effort 为 `low`。可以在启动前通过环境变量覆盖：

```powershell
$env:KITCHEN_CODEX_MODEL = "gpt-6-astra"
$env:KITCHEN_CODEX_EFFORT = "low"
npm run studio
```

Windows 下程序依次从以下位置寻找 Codex：

1. `CODEX_EXECUTABLE` 环境变量；
2. `PATH` 中的 `codex.exe`；
3. Codex 桌面版位于 `%LOCALAPPDATA%\OpenAI\Codex\bin` 下的可执行文件。

自动查找失败时，可以显式指定：

```powershell
$env:CODEX_EXECUTABLE = "C:\path\to\codex.exe"
npm run studio
```

## 核心目录

```text
assets/       编辑器使用的 GLB 组件库
catalog/      柜体、门板、拉手、电器、家具和台面定义
generation/   AI 提示词、组件清单、场景 schema 和示例场景
scripts/      核验、渲染、评价、方案比较及启动脚本
server/       Codex app-server 接入和本地任务服务
src/          编辑器与方案工作台前端代码
```

运行产生的方案、编辑会话、上传图片和重建结果会分别保存在：

```text
generation/runs/
generation/editor_sessions/
generation/reconstructions/
```

这些目录以及整个数据集工作目录已被 `.gitignore` 排除，不会上传到 GitHub。

## 其他命令

```powershell
npm run build
npm run validate:scene -- <scene.json>
npm run render:scene -- <scene.json>
npm run evaluate:functionality -- <final_scene.json>
```

## 使用说明

- 场景坐标系为 `X=宽、Y=深、Z=高`，正面为 `+Y`，向上为 `+Z`。
- 房间使用逆时针正交多边形描述，并支持门窗和对应净空约束。
- AI 生成会消耗当前用户自己的 Codex 使用额度。
- 本项目按本地单用户原型设计，生成服务默认只监听 `127.0.0.1`，不应直接暴露到公网。
