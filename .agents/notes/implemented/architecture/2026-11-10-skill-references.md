# Agent Note: skill.references —— 技能参考文件的可达性

Status: implemented

## Problem

子代理加载 `story-review` 后读不到 `references/review-matrix.md`：`skill` 工具只返回 `SKILL.md` 正文，我们的技能注册没有带资源基址，于是模型面只得到一句「Resources for this skill are managed by provider」，没有路径可解析；子代理只能在会话工作区里 `glob **/review-matrix.md`，0 结果，方法里的参考文件等于不存在。

这是一个已有缺口（D23）。DSH 技能服务声明了资源位置，本行先把基址补上；`query` 检索没有现成 API，但项目可以注册工具提供检索，因此不把 `query` 判成机制偏差，保留为债。

## 源工程证据

- `inkos/packages/core/src/agent/skill-tool.ts:55-120`：`use_skill` 接受 `skillId`，可选 `resourcePath`（精确读一个参考文件）与 `query`（对参考文件做检索）；读取前校验路径在技能目录内、文件是普通文件、大小与文本编码。
- 同文件 `:40-52`：`ActivatedSkillGuidance` 携带 `resources`（`path`／`body`／`charStart`／`charEnd`），参考正文进入激活结果。
- DSH 等价机制：`deepseek-harness/packages/skill/skill/src/index.ts:41-46` 的 `SkillResourceBase`（`directory`／`url`／`opaque`）；`:170-183` 的 `renderSkillContent` 把它渲染成 `<skill_resources>Base directory for this skill: …</skill_resources>`，提示模型按基址解析相对路径、按需加载；`:94-100` 的 `SkillRegistration` 接受 `provider` 与 `resourceBase`（`:110-120` 是 `SkillViewOptions`）。

## Decision

### 注册带资源基址

- `src/core/types.ts` 的 `SkillRegistrationLike` 增加 `provider?: string` 与 `resourceBase?: { kind: 'directory', path: string }`（只写本组合用到的 `directory` 变体）。
- `src/pipelines/long/skills.ts`：`installStorySkills(ctx, packageRoot)` 注册每条随包技能时带上
  - `provider: 'see-dsh-novel'`；
  - `resourceBase: { kind: 'directory', path: join(packageRoot, 'skills', name) }`。
- 技能正文仍从包内文件读取（已登记的机制偏差：随包技能由预设插件注册，不经宿主文件系统 provider）；本行只补资源基址，不改正文来源。

### 模型面读取

- `skill` 工具输出因此带绝对基址；主代理与子代理用现有文件工具按基址读 `references/*.md`。读取工作区外的绝对路径在本会话已可用（调试修订时用 grep 读过 `packages/see-dsh-novel/...`）。
- `renderCraft` 保持现状：阶段上下文仍主动注入 `SKILL.md` 与 `references/` 正文（AGENTS.md 要求主动加载；主会话方法不依赖按需读取）。不改为 `ctx.skills.get()`——`systemPrompt.context()` 的文本回调是同步的，`skills.get` 是异步的，改动会牵动阶段装配，属于后续。阶段注入是整份读取，与能力行标题「按需取参考」不一致，记 D23。

### 债务：query 与参考读取边界

- 源行为：`use_skill.query` 对参考文件做检索。复刻：只暴露目录基址，由模型按路径读取；阶段注入是整份读取。`query` 未实现，记 D23；DSH 没有现成检索 API，但项目可以注册工具，不属机制强制，不登记为偏差。
- 源对越界、符号链接、非文件、512KB、UTF-8 的校验与失败回执未复刻，记 D54。
- `use_skill.resourcePath` 与「按基址读文件」行为等价，不登记偏差。

### 行与债务

- `capabilities.yaml` 的 `skill.references`：implementation 指向 `src/pipelines/long/skills.ts`，consumer 指向 `test/skill-references.test.mjs`，realRun 指向 `artifacts/real-runs/skill.references.json`。
- `docs/scope.md` 保留 D23（query 未实现）；`docs/fidelity-audit.md` 的 `skill.references` 判定改为保真债 D23／D54；`docs/dsh-mapping.md` 只保留技能注册行，不再登记「基址读取替代 query」的偏差。

## Alternatives considered

- **自造 `story_skill_reference` 工具** — 直接、可控。否掉：DSH 已声明 `resourceBase`，新工具是第二套机制；`skill` 工具的输出本来就会渲染基址。
- **把 references 全文并进 `SKILL.md` 的 content** — 注册处少一个字段。否掉：技能目录常驻上下文、正文膨胀，且失去按需加载；参考文件本来就是“按需读”的。
- **改挂 `skill-filesystem` provider，`customSkillDirs` 指向包内 `skills/`** — 最彻底的机制等价，连自建 loader 一起去掉。本行不做：预设层需要注入包绝对路径，还会改掉 `docs/dsh-mapping.md` 里“随包技能由插件注册”的既有偏差；列为后续独立项。
- **`renderCraft` 改用 `ctx.skills.get()`** — 单一正文来源。本行不做：同步文本回调与异步服务不兼容，需要缓存装配；不扩大本行范围。

## Testing

- `test/skill-references.test.mjs`：每条随包技能带 `provider` 与 `resourceBase.directory`；`story-review` 的 `references/review-matrix.md` 可读；`longform-writing` 的参考目录同样可达。
- `test/host.test.mjs`：技能清单与注册路径回归（`installStorySkills` 走同一注册入口）。
- `pnpm run verify` 全绿；`artifacts/real-runs/skill.references.json` 是 process-level 回执，只记录注册字段与源检出目录的读取，不是真实安装包根的会话证据。

## Consequences

- 参考文件的可达性取决于文件工具能否读工作区外路径；当前只在源检出目录验证过（本会话读过 `packages/...`），安装包根仍未被真实会话证明，若沙箱收紧，基址读取会失败。
- 技能正文仍由预设插件从包内读取并注册，`skill-filesystem` 未被启用；这是既有偏差，不在本行消除。
- `renderCraft` 与技能服务仍存在两份正文读取（主会话主动注入与按需加载）；本行只保证参考文件可达，不改注入路径。
- `query` 检索没有复刻；参考文件数量固定且少，模型直接列/读目录即可，行为可观察但不如源精确（D23）。当前测试只断言注册字段与源检出目录可读，未覆盖 `skill` 工具输出或子代理按安装包根读取，生产可读性仍未证（D23）。
