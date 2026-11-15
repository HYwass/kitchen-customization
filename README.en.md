# Kitchen Studio

[中文](README.md) | [English](README.en.md)

Kitchen Studio is a locally hosted AI kitchen customization prototype. Users can describe a room and their preferences, or upload a floor plan or multi-view kitchen photos, and receive an editable, exportable kitchen scene.

## Features

- Generate three differentiated kitchen plans from a room boundary, openings, and preferences;
- Recognize the kitchen boundary and openings from a floor plan;
- Reconstruct an editable scene from multiple photos of the same kitchen;
- Add, remove, move, rotate, and replace components in a Three.js editor;
- Continue editing the current plan with natural-language instructions;
- Display a live price estimate and per-feature AI token usage;
- Export scene JSON, design drawings, and a detailed cost list;
- Switch between Chinese and English while keeping the selected language across both pages.

There are two ways to connect the AI features:

| Mode | Usage source | Recommended for |
| --- | --- | --- |
| Codex | The signed-in user's Codex / ChatGPT plan usage | Users who already have Codex installed and want the quickest local setup |
| OpenAI API | API usage billed to the project that owns `OPENAI_API_KEY` | Users who want independent API billing without a local Codex sign-in |

Both modes use the same frontend, catalog, scene format, validators, and renderer. You only need to configure one mode.

## Requirements

- Git;
- Node.js `20.19+` or `22.12+` (the current Node.js LTS is recommended);
- npm;
- A modern WebGL2 browser with hardware acceleration enabled;
- Codex mode: Codex installed and signed in locally;
- API mode: an OpenAI Platform API key with available API credits or billing.

Check the base environment first:

```powershell
git --version
node --version
npm --version
```

Upgrade Node.js before installing dependencies if the installed version is below the requirement.

---

## Option 1: Run with Local Codex

The following steps use Windows PowerShell. Complete them in order.

### 1. Install and sign in to Codex

On Windows, installing the Codex desktop app and signing in is recommended. An existing Codex CLI installation also works when the `codex` command is available. The signed-in account must have Codex access and available usage.

Open a new PowerShell window and check:

```powershell
codex --version
```

Continue if the command prints a version. If it is unavailable, install Codex first or explicitly configure the `codex.exe` path in step 4.

### 2. Clone the project

```powershell
git clone https://github.com/HYwass/kitchen-customization.git
cd kitchen-customization
```

If the repository is already cloned, run `git pull` inside the project directory.

### 3. Install dependencies

```powershell
npm install
```

This is normally required only on the first run, after dependency updates, or after changing Node.js versions.

### 4. Confirm that Kitchen Studio can find Codex

```powershell
Get-Command codex
```

On Windows, Kitchen Studio searches in this order:

1. The path in `CODEX_EXECUTABLE`;
2. `codex.exe` on `PATH`;
3. `codex.exe` installed by the Codex desktop app under `%LOCALAPPDATA%\OpenAI\Codex\bin`.

If automatic discovery fails, locate the executable:

```powershell
Get-ChildItem "$env:LOCALAPPDATA\OpenAI\Codex\bin" -Recurse -Filter codex.exe
```

Then set its absolute path for the current terminal:

```powershell
$env:CODEX_EXECUTABLE = "C:\full\path\to\codex.exe"
```

### 5. Start the full application

```powershell
npm run studio
```

The terminal should show two services:

- Frontend: `http://127.0.0.1:5173`
- Local AI task service: `http://127.0.0.1:8787`

Keep the terminal open. Press `Ctrl+C` to stop the application.

### 6. Generate and edit a plan

1. Open <http://127.0.0.1:5173/studio.html>;
2. Select **Codex Subscription** under **AI Provider**;
3. Enter a plan name;
4. Draw the room boundary, or upload a floor plan for recognition;
5. Enter openings, layout preference, front style, and other requirements;
6. Enable or disable **Run Full Refinement** as needed;
7. Click **Generate Three Plans**;
8. Compare the completed plans and open one in the editor;
9. Edit manually or use natural-language instructions for further changes;
10. Save the JSON or export drawings and a cost list.

Codex mode defaults to:

```text
model: gpt-6-astra
reasoning effort: low
```

Override these values in the same terminal before startup:

```powershell
$env:KITCHEN_CODEX_MODEL = "gpt-6-astra"
$env:KITCHEN_AI_EFFORT = "low"
npm run studio
```

Model access depends on the signed-in account. A successfully completed request is the final access check.

---

## Option 2: Run with the OpenAI API

API mode does not require a local Codex sign-in, but it requires an OpenAI Platform API key. API usage is billed separately from ChatGPT or Codex subscriptions.

### 1. Prepare OpenAI API access

1. Sign in to [OpenAI Platform](https://platform.openai.com/);
2. Create an API key in a project;
3. Make sure that project has available credits or billing configured;
4. Copy and store the key securely. Never commit it to GitHub.

See the [official OpenAI API quickstart](https://developers.openai.com/api/docs/quickstart).

### 2. Clone the project

```powershell
git clone https://github.com/HYwass/kitchen-customization.git
cd kitchen-customization
```

### 3. Install dependencies

```powershell
npm install
```

The local service calls the Responses API directly, so you do not need to run `npm install openai` separately.

### 4. Set the API key in the current terminal

PowerShell:

```powershell
$env:OPENAI_API_KEY = "sk-your-api-key"
$env:KITCHEN_OPENAI_MODEL = "gpt-6-astra"
$env:KITCHEN_AI_EFFORT = "low"
```

macOS / Linux:

```bash
export OPENAI_API_KEY="sk-your-api-key"
export KITCHEN_OPENAI_MODEL="gpt-6-astra"
export KITCHEN_AI_EFFORT="low"
```

These settings affect only the current terminal session, which is safer and easier to test. Do not put a real key in the README, source code, or `.env.example`.

### 5. Start the application in the same terminal

```powershell
npm run studio
```

The startup log should include:

```text
OpenAI API model: gpt-6-astra (configured)
```

If it shows `OPENAI_API_KEY not set`, stop the service, set the variable in the terminal that will start the application, and try again.

### 6. Select API mode and use the application

1. Open <http://127.0.0.1:5173/studio.html>;
2. Select **OpenAI API** under **AI Provider**;
3. Enter the room and design requirements;
4. Click **Generate Three Plans**;
5. Wait for the API to complete generation, validation, rendering, and evaluation;
6. Choose a plan and open it in the editor;
7. Later natural-language edits continue using the selected API mode;
8. Open **AI Usage** in the lower-right corner to inspect tokens and estimated cost by feature.

The API key is read only by the local Node.js service and is never sent to the browser. Local AI tools block credential reads, network shell commands, deletion, and destructive Git commands. This is a local single-user prototype; do not expose port `8787` or the generation service to the public internet.

---

## Open the Editor without AI

```powershell
npm install
npm run dev
```

Then open <http://127.0.0.1:5173/>. Importing, editing, and exporting scenes works, but AI generation, floor-plan recognition, image reconstruction, and natural-language editing are unavailable.

## Pages and Workflow

### AI Studio

Open <http://127.0.0.1:5173/studio.html>:

- **Design from Brief** generates three plans from room information;
- **Image Reconstruction** reconstructs one result from multi-view photos of the same kitchen;
- **Floor Plan Recognition** extracts the kitchen boundary and openings for review before generation.

### Scene Editor

Open <http://127.0.0.1:5173/>:

- Add or replace cabinets, fronts, handles, appliances, furniture, and worktops;
- Move, rotate, and open cabinet doors and drawers;
- View the live price estimate;
- Edit the current scene with natural-language instructions;
- Save and load scene JSON;
- Export the top plan, relevant wall elevations, and a cost list.

The `English / 中文` control in the upper-right corner shares one language preference across both pages.

## Generated Files

```text
generation/runs/                  Three-plan generation runs
generation/editor_sessions/       Natural-language editor sessions
generation/reconstructions/       Multi-view reconstruction runs
generation/floorplan_recognition/ Floor-plan recognition runs
generation/token_usage/           Token and cost records
```

Each run keeps scene JSON, validation results, rendered images, and process records. These directories are excluded by `.gitignore`.

## Core Directories

```text
assets/       GLB catalog and opening models
catalog/      Cabinets, fronts, handles, appliances, furniture, worktops, and prices
generation/   System prompts, manifest, scene schema, and example scene
scripts/      Startup, validation, rendering, evaluation, and comparison scripts
server/       Codex app-server and OpenAI Responses API integrations
src/          AI Studio and Three.js editor frontend
```

## Useful Commands

```powershell
npm run studio
npm run dev
npm run build
npm run validate:scene -- <scene.json>
npm run render:scene -- <scene.json>
npm run evaluate:functionality -- <final_scene.json>
```

## Troubleshooting

### `Cannot find native binding` or missing `@rolldown/binding-win32-x64-msvc`

Verify the Node.js version, then reinstall dependencies:

```powershell
Remove-Item -Recurse -Force node_modules
npm install
```

If that still fails, remove the lock file and reinstall:

```powershell
Remove-Item -Force package-lock.json
npm install
```

Removing the lock file resolves dependency versions again, so use this only when a normal reinstall does not work.

### `spawn codex ENOENT` or Codex not found

```powershell
codex --version
Get-Command codex
```

If Codex works in the terminal but Kitchen Studio still cannot find it, set `CODEX_EXECUTABLE` to the absolute path of the real `codex.exe`, then run `npm run studio` again in the same terminal.

### OpenAI API mode is disabled

If the startup log says `OPENAI_API_KEY not set`, stop the application, set `$env:OPENAI_API_KEY` in the current terminal, and run `npm run studio` again. Refreshing the browser is not enough because environment changes require a service restart.

### `THREE.WebGLRenderer: Error creating WebGL context`

Enable browser hardware acceleration, update the graphics driver, and restart the browser. Chrome and Edge users can inspect WebGL status at `chrome://gpu` or `edge://gpu`.

### The browser still shows an old interface

Use `Ctrl+F5` for a hard refresh. If it remains stale, stop the service and run `npm run studio` again.

### Generation takes a long time

Turn off **Run Full Refinement** to skip repeated rendering, visual review, and refinement. Full refinement is normally more reliable but takes more time and tokens.

## Data, Pricing, and Security Notes

- Coordinates use `X=width`, `Y=depth`, and `Z=height`; front is `+Y` and up is `+Z`;
- Rooms are counterclockwise orthogonal polygons with door, window, and clearance constraints;
- Editor prices are RMB demonstration estimates and exclude installation, delivery, tax, and building work. Edit `catalog/pricing.json` to change unit prices;
- Actual OpenAI API charges are determined by the OpenAI bill; the interface displays a token-based estimate;
- Dollar values shown for Codex mode are API-equivalent references and do not indicate an extra subscription charge;
- Services listen on `127.0.0.1` by default and should not be exposed to the public internet;
- Never commit API keys, login credentials, or private floor plans to Git.

## Official OpenAI Documentation

- [OpenAI API quickstart](https://developers.openai.com/api/docs/quickstart)
- [Codex app-server](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)
- [Codex as an application platform](https://developers.openai.com/blog/codex-as-a-platform)
