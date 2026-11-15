const STORAGE_KEY = "kitchen-ui-language";
const DEFAULT_LANGUAGE = "zh-CN";
const ENGLISH_LANGUAGE = "en";
const originalDocumentTitle = document.title;

const ENGLISH_TEXT = {
  "AI 多方案厨房设计": "AI Multi-Plan Kitchen Design",
  "AI 方案设计": "AI Design",
  "AI 接入": "AI Provider",
  "Codex 订阅模式": "Codex Subscription",
  "OpenAI API 模式": "OpenAI API",
  "OpenAI API 模式（未配置 Key）": "OpenAI API (Key not configured)",
  "正在检查生成服务": "Checking generation service",
  "AI 工作流": "AI Workflow",
  "需求生成": "Design from Brief",
  "图片重建": "Image Reconstruction",
  "从需求到三套可编辑的\n厨房设计方案": "Three Editable Kitchen Plans\nfrom One Brief",
  "从需求到三套可编辑的厨房设计方案": "Three Editable Kitchen Plans from One Brief",
  "从需求到三套可编辑的": "Three Editable Kitchen Plans",
  "厨房设计方案": "from One Brief",
  "三套方案在同一个 AI 任务中依次生成；可选择完整迭代优化或更省时的快速生成。": "Three distinct plans are generated in one AI task. Choose full iterative refinement or a faster single-pass workflow.",
  "描述你的厨房": "Describe Your Kitchen",
  "在网格上绘制房间轮廓，系统会自动生成 AI 所需的坐标。": "Draw the room outline on the grid. The coordinates required by the AI are generated automatically.",
  "方案名称": "Plan Name",
  "房间边界": "Room Boundary",
  "房间模板": "Room Templates",
  "矩形": "Rectangle",
  "L 型": "L-Shaped",
  "U 型": "U-Shaped",
  "从户型图 AI 识别厨房边界": "Recognize Kitchen Boundary from Floor Plan",
  "选择户型图": "Choose Floor Plan",
  "支持带房间名称、尺寸线或面积标注的 JPG、PNG、WebP": "Supports JPG, PNG and WebP with room labels, dimensions or area annotations",
  "尚未选择图片": "No images selected",
  "识别厨房边界": "Recognize Kitchen Boundary",
  "识别结果会先回填到绘图器，确认无误后再生成方案。": "The recognized boundary is loaded into the editor for review before plan generation.",
  "正交房间边界绘制区域": "Orthogonal room boundary drawing area",
  "房间绘制工具": "Room drawing tools",
  "重新绘制": "Redraw",
  "撤销一点": "Undo Point",
  "闭合房间": "Close Room",
  "查看传给 AI 的边界数据": "View Boundary Data Sent to AI",
  "门窗与固定条件": "Doors, Windows & Fixed Conditions",
  "布局偏好": "Layout Preference",
  "智能选择": "Smart Selection",
  "一字型": "Single-Wall",
  "双廊型": "Galley",
  "门板风格": "Front Style",
  "智能搭配": "Smart Matching",
  "白色平板": "White Slab",
  "灰色平板": "Grey Slab",
  "橡木平板": "Oak Slab",
  "白色 Shaker": "White Shaker",
  "深绿 Shaker": "Dark Green Shaker",
  "胡桃木纹理": "Walnut Grain",
  "其他需求": "Other Requirements",
  "执行完整 refine": "Run Full Refinement",
  "每套方案都会核验、渲染、看图并按反馈迭代；关闭后只生成和检查一次，可节省时间与 Token。": "Each plan is validated, rendered, visually reviewed and refined. Turn this off for a faster, lower-token single pass.",
  "生成三套方案": "Generate Three Plans",
  "从多视角照片还原\n可编辑厨房场景": "Reconstruct an Editable Kitchen\nfrom Multi-View Photos",
  "从多视角照片还原可编辑厨房场景": "Reconstruct an Editable Kitchen from Multi-View Photos",
  "从多视角照片还原": "Reconstruct an Editable Kitchen",
  "可编辑厨房场景": "from Multi-View Photos",
  "上传同一个厨房的任意张照片。AI 会统一识别房间、门窗、柜体和电器，并从现有组件库中完成一次重建。": "Upload any number of photos of the same kitchen. The AI identifies the room, openings, cabinets and appliances, then reconstructs the scene from the existing catalog.",
  "上传厨房照片": "Upload Kitchen Photos",
  "尽量覆盖不同墙面，并保留能够关联视角的共同物件。": "Cover different walls and include shared objects that help relate the views.",
  "场景名称": "Scene Name",
  "多视角图片": "Multi-View Images",
  "选择图片": "Choose Images",
  "支持 JPG、PNG、WebP，可一次选择多张": "Supports JPG, PNG and WebP; select multiple images at once",
  "尺寸与场景补充说明（可选）": "Dimensions & Scene Notes (Optional)",
  "图片重建只执行一次，不进行自动渲染或 refine。完成后可直接进入编辑器检查和修改。": "Image reconstruction runs once without automatic rendering or refinement. Open the result directly in the editor to review and adjust it.",
  "开始场景重建": "Start Reconstruction",
  "正在完成三套厨房方案": "Generating Three Kitchen Plans",
  "正在连接生成服务…": "Connecting to generation service…",
  "生成记录": "Generation Log",
  "选择最适合你的方案": "Choose the Best Plan for You",
  "重新设计": "Start New Design",
  "评价结果用于概念方案比较，不代替施工、安全或法规审核。": "Scores are for conceptual comparison only and do not replace construction, safety or regulatory review.",
  "正在重建厨房场景": "Reconstructing Kitchen Scene",
  "正在上传图片…": "Uploading images…",
  "单次重建": "Single-Pass Reconstruction",
  "查看全部视角 → 统一空间关系 → 匹配组件库 → 输出场景 JSON": "Review all views → align spatial relationships → match catalog assets → output scene JSON",
  "重建记录": "Reconstruction Log",
  "场景重建已完成": "Scene Reconstruction Complete",
  "重建结果已经转换为 Kitchen Studio 场景 JSON。现在可以进入编辑器查看、调整组件并导出最终结果。": "The reconstruction has been converted to Kitchen Studio scene JSON. Open it in the editor to review, adjust components and export the final result.",
  "进入编辑器": "Open Editor",
  "下载场景 JSON": "Download Scene JSON",
  "重建另一个场景": "Reconstruct Another Scene",
  "请先选择一张户型图。": "Choose a floor plan image first.",
  "无法创建户型图识别任务": "Could not create the floor plan recognition task",
  "户型图上传失败": "Floor plan upload failed",
  "无法启动户型图识别": "Could not start floor plan recognition",
  "识别结果不存在": "Recognition result is unavailable",
  "图中信息不足，请手动绘制或补充尺寸。": "The image does not contain enough information. Draw the boundary manually or add dimensions.",
  "未自动应用：需要人工补充信息": "Not applied automatically: manual information is required",
  "未报告额外估算项": "No additional estimates reported",
  "户型图中未识别到厨房直接门窗，请人工确认。": "No direct kitchen doors or windows were recognized. Please verify them manually.",
  "尺寸待确认": "Dimensions to be confirmed",
  "请先闭合并完成房间边界。": "Close and complete the room boundary first.",
  "无法创建生成任务": "Could not create the generation task",
  "请至少选择一张厨房图片。": "Choose at least one kitchen image.",
  "无法创建图片重建任务": "Could not create the image reconstruction task",
  "图片已上传，正在启动 Codex": "Images uploaded; starting Codex",
  "无法启动图片重建任务": "Could not start the image reconstruction task",
  "房间边界必须是合法的 JSON 坐标数组。": "The room boundary must be a valid JSON coordinate array.",
  "房间边界至少需要四个有效的 [x, y] 顶点。": "The room boundary needs at least four valid [x, y] vertices.",
  "找不到该生成任务": "Generation task not found",
  "找不到该图片重建任务": "Image reconstruction task not found",
  "该重建任务尚未完成，且无法从当前服务进程恢复。": "This reconstruction is incomplete and cannot be restored from the current service process.",
  "重建结果缺少场景 JSON": "The reconstruction result is missing scene JSON",
  "无法读取方案结果": "Could not read plan results",

  "方案估价": "Estimate",
  "当前方案费用": "Current Plan Cost",
  "厨房家具": "Kitchen Furniture",
  "台面与饰面": "Worktops & Finishes",
  "厨房电器": "Kitchen Appliances",
  "嵌入式及独立式电器、水槽与龙头": "Built-in and freestanding appliances, sinks and faucets",
  "台面风格已更新": "Worktop style updated",
  "隐藏组件栏": "Hide asset panel",
  "显示组件栏": "Show asset panel",
  "隐藏对象编辑栏": "Hide inspector",
  "显示对象编辑栏": "Show inspector",
  "◀ 组件栏": "◀ Assets",
  "组件栏 ▶": "Assets ▶",
  "对象栏 ▶": "Inspector ▶",
  "◀ 对象栏": "◀ Inspector",
  "重置场景": "Reset Scene",
  "载入 JSON": "Load JSON",
  "保存 JSON": "Save JSON",
  "导出图纸": "Export Drawings",
  "导出成本清单": "Export Cost List",
  "2.4 m 直线厨房": "2.4 m Linear Kitchen",
  "选择资产添加到场景；点击模型后可移动、旋转和替换组件。": "Add assets to the scene, then select a model to move, rotate or replace its components.",
  "个柜体": "cabinets",
  "个资产": "assets",
  "添加柜体": "Add Cabinets",
  "台面风格": "Worktop Style",
  "当前材质": "Current Material",
  "场景层级": "Scene Hierarchy",
  "选择 (Q)": "Select (Q)",
  "移动 (W)": "Move (W)",
  "旋转 (E)": "Rotate (E)",
  "打开柜门或抽屉 (O)": "Open Door or Drawer (O)",
  "关闭柜门或抽屉 (O)": "Close Door or Drawer (O)",
  "聚焦选中 (F)": "Focus Selection (F)",
  "删除选中 (Delete)": "Delete Selection (Delete)",
  "左键点击": "Left click",
  "左键拖动": "Left drag",
  "中键拖动": "Middle drag",
  "滚轮": "Wheel",
  "选择": "Select",
  "旋转视角": "Orbit",
  "平移视角": "Pan",
  "缩放": "Zoom",
  "移动 / 旋转": "Move / Rotate",
  "正在载入厨房资产…": "Loading kitchen assets…",
  "未选择对象": "No Object Selected",
  "点击场景中的柜体开始编辑。": "Select a cabinet in the scene to start editing.",
  "可以修改位置、朝向、柜体、门板、拉手和电器。": "Edit position, orientation, cabinet, front, handle and appliances.",
  "对话修改方案": "Edit with AI",
  "本地生成服务": "Local generation service",
  "生成修改": "Generate Changes",
  "生成中…": "Generating…",
  "候选方案已在编辑器中预览。": "The candidate plan is previewed in the editor.",
  "撤销预览": "Discard Preview",
  "接受修改": "Accept Changes",
  "当前柜体没有可开合的门板或抽屉": "This cabinet has no operable doors or drawers",
  "正在打开柜门或抽屉": "Opening doors or drawers",
  "正在关闭柜门或抽屉": "Closing doors or drawers",
  "当前房间中没有可用的放置位置": "No valid placement is available in the room",
  "该资产不能作为独立组件添加": "This asset cannot be added as a standalone component",
  "场景 JSON 已保存": "Scene JSON saved",
  "场景 JSON 已载入": "Scene JSON loaded",
  "已恢复演示场景": "Demo scene restored",
  "请先接受或撤销当前候选方案": "Accept or discard the current candidate first",
  "正在创建修改任务…": "Creating edit task…",
  "已开始修改。我会核验布局、渲染两张视图并检查结果。": "Editing has started. The layout will be validated and reviewed in two rendered views.",
  "候选方案已完成并载入预览。": "The candidate plan is complete and loaded for preview.",
  "AI 候选方案已载入，可接受或撤销": "AI candidate loaded; accept or discard it",
  "已撤销候选方案，恢复修改前的场景。": "Candidate discarded and the previous scene restored.",
  "已接受修改。你可以继续手动编辑或提出下一项调整。": "Changes accepted. Continue editing manually or request another adjustment.",
  "已接受 AI 修改": "AI changes accepted",
  "本地生成服务已连接": "Local generation service connected",
  "本地生成服务未连接": "Local generation service disconnected",
  "本地生成服务未连接；请使用 npm run studio 启动": "Local generation service is offline; start it with npm run studio",
  "对象": "Object",
  "名称": "Name",
  "柜体类型": "Cabinet Type",
  "尺寸": "Dimensions",
  "坐标系": "Coordinate System",
  "绕 Z 旋转": "Rotate around Z",
  "门板与布局": "Front & Layout",
  "无 front": "No front",
  "拉手": "Handle",
  "无拉手": "No handle",
  "每个槽位只能替换为相同接口的电器。": "Each slot can only use an appliance with the same interface.",
  "当前没有兼容电器": "No compatible appliances",
  "删除这个柜体": "Delete Cabinet",
  "独立组件": "Standalone Component",
  "类别": "Category",
  "资产": "Asset",
  "删除这个组件": "Delete Component",
  "烤箱": "Oven",
  "水槽": "Sink",
  "灶台": "Cooktop",
  "水龙头": "Faucet",
  "冰箱": "Fridge",
  "油烟机": "Extractor Hood",
  "洗碗机": "Dishwasher",
  "电器": "Appliance",

  "功能丰富": "Feature Rich",
  "更完整的电器、储物和操作功能": "More complete appliances, storage and workflow features",
  "空间利用": "Space Efficient",
  "更高的墙面利用率和连续工作台": "Higher wall utilization and more continuous worktop",
  "宽敞通透": "Open & Spacious",
  "完整基础功能与更大的活动空间": "Complete essential functions with more circulation space",
  "暂无渲染图": "No render available",
  "暂无分项评价": "No dimension scores available",
  "查看顶视图": "View Top Render",
  "查看透视图": "View Perspective Render",
  "打开编辑器": "Open Editor",
  "选择并编辑": "Select & Edit",

  "Token 用量": "Token Usage",
  "AI 用量": "AI Usage",
  "AI 用量明细": "AI Usage Details",
  "总 Token": "Total Tokens",
  "估算费用": "Estimated Cost",
  "输入": "Input",
  "输出": "Output",
  "未定价": "Unpriced",
  "尚无已报告的 Token 记录": "No reported token usage yet",
  "全部功能": "All Features",
  "户型图识别": "Floor Plan Recognition",
  "AI 生成场景": "AI Scene Generation",
  "编辑器语言修改": "Editor Language Editing",
  "多视角图片重建": "Multi-View Reconstruction",
  "缓存输入": "Cached input",
  "推理": "Reasoning",
  "最近任务": "Recent tasks",
  "正在读取用量…": "Loading usage…",
  "用量服务暂不可用": "Usage service is temporarily unavailable",
  "按当前 OpenAI API Standard 短上下文单价折算。API 项为 Token 费用估算；Codex 项仅是等价 API 参考成本，不代表订阅额外扣费。缓存 Token 已包含在输入中，推理 Token 已包含在输出中，不重复相加。Codex 未返回 usage 时不会估算。": "Converted using current OpenAI API Standard short-context pricing. API values are estimated token costs; Codex values are API-equivalent references and do not indicate an additional subscription charge. Cached tokens are included in input and reasoning tokens in output, so they are not counted twice. No estimate is made when Codex does not report usage.",

  "拖动墙体可平行调整；所有尺寸自动吸附到 0.1 m。": "Drag a wall to move it in parallel. All dimensions snap to 0.1 m.",
  "依次点击墙角。线段会自动保持水平或垂直，完成后点击“闭合房间”。": "Click each corner in sequence. Segments stay horizontal or vertical; click “Close Room” when finished.",
  "无法自动闭合：当前墙体会发生交叉，请撤销最后几个转角后重试。": "Cannot close automatically because walls would intersect. Undo the last few corners and try again.",
  "房间至少需要四个转角": "The room needs at least four corners",
  "房间面积不能小于 1 ㎡": "Room area must be at least 1 m²",
  "存在长度为零的墙体": "A wall has zero length",
  "当前仅支持水平或垂直墙体": "Only horizontal and vertical walls are supported",
  "墙体不能交叉或重叠": "Walls cannot intersect or overlap"
};

const PLACEHOLDER_TEXT = {
  "例如：南墙左侧有一扇 0.9 m 内开门；北墙中部有一扇窗，窗台高 1.15 m。水源位于北墙……": "Example: a 0.9 m inward-opening door is on the left of the south wall; a window with a 1.15 m sill is centered on the north wall. Water supply is on the north wall…",
  "例如：必须有独立冰箱和洗碗机；希望储物空间充足；不要在窗前放吊柜。": "Example: include a freestanding fridge and dishwasher; prioritize storage; do not place wall cabinets in front of the window.",
  "例如：房间约 3.8 × 3.2 m；窗台高约 1.1 m；所有照片属于同一个厨房。没有实测信息可以留空。": "Example: room is about 3.8 × 3.2 m; window sill is about 1.1 m high; all photos show the same kitchen. Leave blank if no measurements are available.",
  "例如：保留水槽位置，把冰箱移到门的另一边，并增加一台洗碗机。": "Example: keep the sink in place, move the fridge to the other side of the door, and add a dishwasher."
};

const EXACT_TEXT = { ...ENGLISH_TEXT, ...PLACEHOLDER_TEXT };
const nodeSources = new WeakMap();
const attributeSources = new WeakMap();
let currentLanguage = readStoredLanguage();
let observer = null;
let switchButton = null;
let applying = false;

function readStoredLanguage() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === ENGLISH_LANGUAGE
      ? ENGLISH_LANGUAGE
      : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

function translateKnownText(value) {
  if (!value || currentLanguage !== ENGLISH_LANGUAGE) return value;
  if (EXACT_TEXT[value]) return EXACT_TEXT[value];

  let translated = value;
  const replacements = [
    [/按\s+(.+?)\s+OpenAI API Standard 短上下文单价折算。API 项为 Token 费用估算；Codex 项仅是等价 API 参考成本，不代表订阅额外扣费。缓存 Token 已包含在输入中，推理 Token 已包含在输出中，不重复相加。Codex 未返回 usage 时不会估算。/g, "Converted using $1 OpenAI API Standard short-context pricing. API values are estimated token costs; Codex values are API-equivalent references and do not indicate an additional subscription charge. Cached tokens are included in input and reasoning tokens in output, so they are not counted twice. No estimate is made when Codex does not report usage."],
    [/正在载入\s+(\d+)\s+个厨房资产…/g, "Loading $1 kitchen assets…"],
    [/已导出\s+(\d+)\s+页图纸：俯视图/g, "Exported $1 drawing pages: top plan"],
    [/已导出\s+(\d+)\s+页成本清单，共\s+(\d+)\s+项/g, "Exported a $1-page cost list with $2 line items"],
    [/以及\s+(\d+)\s+张吊柜墙面立面图/g, "and $1 wall elevations"],
    [/输入\s+([\d,.]+)\s*·\s*输出\s+([\d,.]+)/g, "Input $1 · Output $2"],
    [/最近任务（(\d+)）/g, "Recent tasks ($1)"],
    [/正在上传图片\s+(\d+)\s*\/\s*(\d+)/g, "Uploading image $1 / $2"],
    [/已识别\s+/g, "Recognized "],
    [/识别结果已回填。请对照原图检查墙长和门窗，必要时拖动墙体校正。/g, "Recognition results loaded. Compare wall lengths and openings with the original image, then drag walls to correct them if needed."],
    [/正在上传户型图…/g, "Uploading floor plan…"],
    [/正在识别厨房、尺寸和门窗…/g, "Recognizing the kitchen, dimensions and openings…"],
    [/正在识别户型图/g, "Recognizing floor plan"],
    [/正在重建/g, "Reconstructing"],
    [/服务已连接\s*·/g, "Service connected ·"],
    [/生成服务未启动/g, "Generation service is not running"],
    [/正在连接 Codex app-server/g, "Connecting to Codex app-server"],
    [/正在连接生成服务/g, "Connecting to generation service"],
    [/正在创建/g, "Creating"],
    [/正在上传/g, "Uploading"],
    [/正在识别/g, "Recognizing"],
    [/正在生成/g, "Generating"],
    [/正在重建/g, "Reconstructing"],
    [/正在渲染/g, "Rendering"],
    [/正在核验/g, "Validating"],
    [/正在读取/g, "Reading"],
    [/识别失败：/g, "Recognition failed: "],
    [/重建失败：/g, "Reconstruction failed: "],
    [/生成失败：/g, "Generation failed: "],
    [/修改失败：/g, "Edit failed: "],
    [/载入失败：/g, "Load failed: "],
    [/重置失败：/g, "Reset failed: "],
    [/图纸导出失败：/g, "Drawing export failed: "],
    [/成本清单导出失败：/g, "Cost list export failed: "],
    [/无法应用识别结果：/g, "Could not apply recognition result: "],
    [/未知错误/g, "Unknown error"],
    [/张图片/g, " images"],
    [/个柜体/g, " cabinets"],
    [/个资产/g, " assets"],
    [/面墙/g, " walls"],
    [/个转角/g, " corners"],
    [/绘制中/g, "Drawing"],
    [/置信度/g, "Confidence"],
    [/面积/g, "Area"],
    [/功能性评价/g, "Functionality score"],
    [/分。/g, " points."],
    [/已完成/g, "Complete"],
    [/已连接/g, "Connected"],
    [/已载入/g, "Loaded"],
    [/已保存/g, "Saved"],
    [/已删除：/g, "Deleted: "],
    [/已添加：/g, "Added: "],
    [/已导出/g, "Exported"],
    [/请先/g, "Please first "],
    [/点击可更换图片/g, "Click to replace image"],
    [/视角\s+(\d+)/g, "View $1"],
    [/图片\s+([^\s]+)\s+上传失败/g, "Image $1 upload failed"],
    [/正在上传：/g, "Uploading: "],
    [/墙段\s+(\d+)/g, "wall segment $1"],
    [/宽\s+([\d.]+)\s*m/g, "width $1 m"],
    [/距墙段起点\s+([\d.]+)\s*m/g, "$1 m from wall start"],
    [/窗台高\s+([\d.]+)\s*m/g, "sill height $1 m"],
    [/通向/g, "connects to "],
    [/厨房家具/g, "Kitchen furniture"],
    [/台面与饰面/g, "Worktops & finishes"],
    [/厨房电器/g, "Kitchen appliances"],
    [/台面及开孔/g, "Worktop and cutouts"],
    [/墙面砖/g, "backsplash tiles"],
    [/侧板与填缝板/g, "end and filler panels"],
    [/桌椅/g, "tables and chairs"],
    [/待确认/g, "To be confirmed"],
    [/目录单价/g, "Catalog unit price"],
    [/当前方案/g, "Current plan"],
    [/演示估价/g, "Demo estimate"],
    [/不含安装、运输、税费及硬装工程，以实际采购报价为准。/g, "Excludes installation, delivery, taxes and building work. Actual supplier quotations prevail."],
    [/台面材料/g, "Worktop material"],
    [/台面设备开孔/g, "Worktop cutouts"],
    [/台面后挡墙面砖/g, "Backsplash tiles"],
    [/柜体外露侧板/g, "Cabinet end panels"],
    [/柜墙填缝板/g, "Wall filler panels"],
    [/分类金额取整调整/g, "Category rounding adjustment"],
    [/ · 柜体/g, " · Cabinet"],
    [/ · 内部五金/g, " · Internal fittings"],
    [/ · 门板/g, " · Front"],
    [/ · 拉手/g, " · Handle"],
    [/ · 嵌入组件/g, " · Built-in component"],
    [/未知柜体/g, "Unknown cabinet"],
    [/未知门板/g, "Unknown front"],
    [/未配置价格/g, "has no configured price"],
    [/柜体/g, "cabinet"],
    [/门板/g, "front"],
    [/拉手/g, "handle"],
    [/电器/g, "appliance"]
  ];
  for (const [pattern, replacement] of replacements) translated = translated.replace(pattern, replacement);
  return translated;
}

function translatePreservingWhitespace(value) {
  const match = String(value).match(/^(\s*)([\s\S]*?)(\s*)$/);
  const source = match?.[2] ?? value;
  return `${match?.[1] ?? ""}${translateKnownText(source)}${match?.[3] ?? ""}`;
}

function shouldIgnore(element) {
  return !element || Boolean(element.closest?.("script, style, [data-i18n-ignore]"));
}

function translateTextNode(node) {
  if (shouldIgnore(node.parentElement) || !node.nodeValue?.trim()) return;
  const previous = nodeSources.get(node);
  const source = previous && node.nodeValue === previous.rendered ? previous.source : node.nodeValue;
  const rendered = currentLanguage === ENGLISH_LANGUAGE ? translatePreservingWhitespace(source) : source;
  nodeSources.set(node, { source, rendered });
  if (node.nodeValue !== rendered) node.nodeValue = rendered;
}

function translateAttribute(element, attribute) {
  if (shouldIgnore(element) || !element.hasAttribute(attribute)) return;
  let records = attributeSources.get(element);
  if (!records) {
    records = {};
    attributeSources.set(element, records);
  }
  const current = element.getAttribute(attribute) ?? "";
  const previous = records[attribute];
  const source = previous && current === previous.rendered ? previous.source : current;
  const rendered = currentLanguage === ENGLISH_LANGUAGE ? translateKnownText(source) : source;
  records[attribute] = { source, rendered };
  if (current !== rendered) element.setAttribute(attribute, rendered);
}

function translateElement(root) {
  if (!(root instanceof Element) || shouldIgnore(root)) return;
  for (const attribute of ["placeholder", "title", "aria-label", "alt"]) translateAttribute(root, attribute);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) translateTextNode(walker.currentNode);
  for (const element of root.querySelectorAll("[placeholder], [title], [aria-label], [alt]")) {
    for (const attribute of ["placeholder", "title", "aria-label", "alt"]) translateAttribute(element, attribute);
  }
}

function translateDocument() {
  applying = true;
  document.documentElement.lang = currentLanguage;
  translateElement(document.body);
  document.title = currentLanguage === ENGLISH_LANGUAGE
    ? originalDocumentTitle.replace("AI 方案设计", "AI Design")
    : originalDocumentTitle;
  if (switchButton) {
    switchButton.textContent = currentLanguage === ENGLISH_LANGUAGE ? "中文" : "English";
    switchButton.title = currentLanguage === ENGLISH_LANGUAGE ? "切换为中文" : "Switch to English";
    switchButton.setAttribute("aria-label", switchButton.title);
  }
  applying = false;
}

function observeDynamicContent() {
  observer?.disconnect();
  observer = new MutationObserver((mutations) => {
    if (applying) return;
    applying = true;
    for (const mutation of mutations) {
      if (mutation.type === "characterData") translateTextNode(mutation.target);
      if (mutation.type === "attributes") translateAttribute(mutation.target, mutation.attributeName);
      for (const node of mutation.addedNodes || []) {
        if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
        else if (node.nodeType === Node.ELEMENT_NODE) translateElement(node);
      }
    }
    applying = false;
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["placeholder", "title", "aria-label", "alt"]
  });
}

function setLanguage(language) {
  currentLanguage = language === ENGLISH_LANGUAGE ? ENGLISH_LANGUAGE : DEFAULT_LANGUAGE;
  try {
    window.localStorage.setItem(STORAGE_KEY, currentLanguage);
  } catch {
    // The UI can still switch when storage is unavailable.
  }
  translateDocument();
  window.dispatchEvent(new CustomEvent("kitchen-language-change", { detail: { language: currentLanguage } }));
}

export function getCurrentLanguage() {
  return currentLanguage;
}

export function installLanguageSwitcher() {
  if (switchButton) return switchButton;
  if (!document.body) return null;
  switchButton = document.createElement("button");
  switchButton.type = "button";
  switchButton.className = "language-switcher";
  switchButton.dataset.i18nIgnore = "true";
  switchButton.addEventListener("click", () => {
    setLanguage(currentLanguage === ENGLISH_LANGUAGE ? DEFAULT_LANGUAGE : ENGLISH_LANGUAGE);
  });
  document.body.append(switchButton);
  translateDocument();
  observeDynamicContent();
  return switchButton;
}
