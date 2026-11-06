# 多方案生成与比较

该模式在现有单方案流水线外增加一层编排，不改变编辑器场景格式。服务器先固定三份不同的方案策略，然后在同一个 Astra 任务中依次生成三套方案。第一轮读取共享规则和组件库，后续方案复用同一任务的上下文，但各自只写入自己的方案目录。完整模式对每套方案执行“生成 → Schema核验 → 布局核验 → 顶视图/透视图渲染 → 视觉检查 → 最多三次refine → 功能性评价”；快速模式只执行一次生成、核验、渲染和评价，不做多轮refine。两种模式最终都得到可导入编辑器的 `final_scene.json` 和用户可读的 `functionality_evaluation.json`。

## 默认方案

默认读取 `generation/multi_plan_profiles.json` 并生成三套方案：

- `function_rich`：优先完整电器、储物和操作功能。
- `space_efficient`：优先墙面利用率、连续性、储物和工作台密度。
- `spacious`：保留基础功能，同时减少落地占用并扩大自由活动空间。

用户可以指定其他侧重点或方案数量，但房间、门窗、固定设施和硬性需求必须在所有方案间保持一致。

## 在Codex中发起任务

先让模型读取以下文件：

```text
generation/system_prompt.md
generation/generation_manifest.json
generation/scene.schema.json
generation/example_scene.json
generation/multi_plan_profiles.json
```

然后给出用户需求，例如：

```text
请执行完整的多方案生成工作流，为以下厨房生成三套可比较的方案。

房间边界：[[0,0],[4.8,0],[4.8,3.6],[0,3.6]]
层高：2.7 m
门窗：……
固定条件：水源位于……，燃气位于……
硬性需求：必须有水槽、水龙头、灶台、油烟机、烤箱和冰箱。
风格偏好：白色平板门、浅灰石英石工作台。

使用默认的功能丰富、空间利用率高、宽敞通透三个方案侧重点。在同一个任务中依次完成三套方案的生成、核验、渲染和refine，分别保存完整迭代记录和final_scene.json，最后运行方案比较器并生成comparison.json。
```

## 输出目录

```text
generation/runs/<multi_run_id>/
├── request.md
├── multi_plan_request.json
├── diversity_strategy.json
├── plans/
│   ├── function_rich/
│   │   ├── plan_profile.json
│   │   ├── iteration_00/
│   │   ├── ...
│   │   ├── final_scene.json
│   │   ├── functionality_evaluation.json
│   │   └── run_summary.json
│   ├── space_efficient/
│   └── spacious/
└── comparison.json
```

三个 `final_scene.json` 都使用原有 `scene.schema.json`，可以分别导入编辑器。

`diversity_strategy.json` 由服务器在生成场景前写入，固定三个方案各自的布局、柜体、电器和视觉差异策略。三个方案使用相同的房间与硬约束，在同一个 Astra 任务的三个连续轮次中分别收到不同策略提示词。比较器最后输出 `pairwiseDiversity`、`insufficientlyDifferentPairs` 和 `diversityPassed`，只用于评价和向用户提示差异程度，不会触发重生成。

## 单独评价一个最终方案

评价器需要最终场景和该方案选中迭代的核验报告：

```powershell
npm run evaluate:functionality -- .\generation\runs\<run_id>\final_scene.json `
  --validation .\generation\runs\<run_id>\iteration_01\validation.json `
  --output .\generation\runs\<run_id>\functionality_evaluation.json
```

它会评价方案合法性、基础功能、操作动线、工作台空间、储物能力、空间利用和宽敞程度，并给出普通用户可读的优点、问题与改进建议。功能性报告用于方案比较，不会写回或修改 `final_scene.json`。

## 单独重新生成比较报告

如果三套方案已经生成，可以在项目根目录执行：

```powershell
npm run compare:plans -- .\generation\runs\<multi_run_id> `
  --output .\generation\runs\<multi_run_id>\comparison.json
```

比较器读取每套方案的最终场景和选中迭代的 `validation.json`，报告以下内容：

- 硬校验是否通过
- 基础功能完整度
- 电器功能丰富度
- 估算储物体积
- 工作台面积
- 紧凑度和墙面利用率
- 自由地面比例
- 每个设计目标下的方案排名
- 完全相同的结构化布局警告

储物体积和自由地面比例是用于方案间比较的近似指标，不替代真实柜体净容量或人体工学通道测量。硬校验失败的方案始终排在合法方案之后。
