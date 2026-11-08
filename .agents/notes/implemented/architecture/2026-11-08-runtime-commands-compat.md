# Agent Note: runtime.commands —— 立项命令对齐源 CLI 的选项与缺省

Status: implemented

## Problem

`/story-init` 与源工程的 `book create` 在选项面上有四处可观察差异：

1. 规模选项名（D3）：命令叫 `--chapters`／`--words`，源工程是 `--target-chapters`／`--chapter-words`。
2. 缺省分类（D4）：源工程未给 `--genre`／`--platform` 时落 `xuanhuan`／`tomato`；命令不写这两个字段，`work.json` 的 `metadata` 与立项回执都少这两项。
3. `--lang` 取值：源工程按前缀归一（`zh-CN`、`en-US` 都能用），未知值回退；命令只认小写 `zh`／`en`，其它值报错。
4. 数值读取：源工程用 `parseInt(value, 10)` 把前导整数写进 `metadata`（`2.5` → 2、`80abc` → 80、`+80` → 80）；命令要求整数字面量，这是源工程没有的收窄。

第 1、2 条是保真债清单里的 D3／D4；第 3、4 条影响写入 `work.json` 的产品数据，也是自创的格式限制，应在同一行一起偿还。

选项的**输入语法**是另一件事：源工程由 commander 解析，接受 `--flag=value` 与重复选项后者覆盖；DSH 命令自己拥有 `rawInput` 的语法，这部分差异属于已登记的 CLI → DSH command 入口偏差，不算产品债。命令语法也扩到源写法，并显式取代旧 Note 的「严格语法」决定。

另有两处结构差异和一处审计错误，登记为债：

- 源工程 `book create` 在一次命令里同时建书并生成基础设定；复刻的命令只写身份，基础设定由 `story_next`／面板阶段继续。DSH 命令可以唤醒回合（`CommandInvocation.agent` 是完整的 `Agent`，`/plan` 就用 `agent.steer`），所以两步流程是已记录的设计选择，不是机制限制，属于保真债（D19）。
- 源工程 `book create` 遇到已存在但不完整的作品目录会删除重建，只有完整作品才拒绝；复刻命令拒绝任何已存在的 `work.json`，所以基础设定写坏后不能重新立项。这是行为差异，属于保真债（D21）。
- 审计稿写「`--lang` 缺省由题材决定」，与实现不符：`book.ts` 用的是 `resolveCliLanguage(opts.lang ?? config.language)`，`config.language` 来自项目配置、默认 `zh`；CLI 帮助里的 “Defaults from genre.” 不是实现行为。

## 源工程证据

- `inkos/packages/cli/src/commands/book.ts` 的 `book create`：`--title` 必填；`--genre` 默认 `xuanhuan`；`--platform` 默认 `tomato`；`--target-chapters` 默认 `200`；`--chapter-words` 默认 `3000`；`--brief <path>` 读文件；`--lang` 缺省取 `resolveCliLanguage(opts.lang ?? config.language)`；`targetChapters`／`chapterWordCount` 用 `parseInt(…, 10)`；action 调 `createBookFoundationTool`，由 `pipeline.initBook` 跑 architect；已存在目录先用 `isCompleteBookDirectory` 判完整作品，不完整就 `rm` 后重建。
- `inkos/packages/cli/src/localization.ts` 的 `resolveCliLanguage`：显式值先 trim、转小写，`en*` 归 `en`、`zh*` 归 `zh`；不匹配再看 `INKOS_LOCALE`、`LC_ALL`／`LC_MESSAGES`／`LANG`；最后回退 `zh`。
- `inkos/packages/core/src/models/project.ts`：`language: z.enum(["zh", "en"]).default("zh")`，`config.language` 的来源与缺省。
- `inkos/packages/cli/package.json` 依赖 `commander ^13.0.0`；它的 option 处理器对非 variadic 选项每次写入覆盖前值，因此重复选项是后者生效，不是报错。
- `inkos/packages/core/src/harness/tools/longform-production.ts` 的 `createBookFoundationTool`：CLI 传入 `createBook` payload 后，`pipeline.initBook` 生成并写入基础设定；同一工具单独调用时 genre／platform 的兜底是 `other`。
- DSH `commands` 的 `CommandInvocation` 把接收命令的完整 `Agent` 交给处理器；`/plan` 用 `agent.steer` 投递后续消息，证明命令可以唤醒回合。

## Decision

### 选项名与缺省值

- `--target-chapters`／`--chapter-words` 是文档主名；`--chapters`／`--words` 保留为同义别名，避免已经写在提示、测试与真机回执里的短名失效。
- `genre` 缺省 `xuanhuan`，`platform` 缺省 `tomato`，随 `work.json` 的 `metadata` 落盘，`describeWork` 的回执相应出现这两项。
- 规模缺省保持 200 章 × 3000 字；英文作品也不按语言改单章字数，与 CLI 的固定值一致。
- `language` 缺省是 `zh`（`prepareWork` 的默认），不引入源工程的项目配置文件。

### 选项语法与取值

- 同时接受 `--flag value` 与 `--flag=value`；未知选项仍报错。
- 同一选项重复时后者覆盖前者（commander 行为），不再报「重复」；跨别名的重复同样按出现顺序后者生效。旧 Note 的「拒绝重复选项」由本篇显式取代。
- 规模选项按 `parseInt(value, 10)` 取前导整数：`2.5` → 2、`80abc` → 80、`+80` → 80、`1e3` → 1；取不出数字时报错；非正数仍由 `prepareWork` 拒绝。
- 空值按源行为分开处理：`--brief=` 视为没有简报（源 `opts.brief ? … : undefined`），继续用 `Create <标题>`；`--lang=` 按未知语言回退；`--genre=`／`--platform=` 报错（源 schema 要求非空）；`--target-chapters=`／`--chapter-words=` 报错（`parseInt('')` 不是数字）。
- `--` 之后的内容仍按标题原文处理；标题继续用位置参数，不新增 `--title`。标题入口是 CLI → DSH command 的入口差异；再加一个标题来源只会让「两个都给时用哪个」变成新规则。`--json` 这类输出格式选项不进入命令面，命令只返回文本。

### `--lang` 的归一与回退

- 大小写不敏感：以 `zh` 开头 → `zh`，以 `en` 开头 → `en`。
- 其余值不报错，回退到缺省 `zh`。源工程会先回退到项目语言，再读 `INKOS_LOCALE` 与系统 locale；DSH 没有项目语言配置，当前不读宿主环境变量，落点是 `zh`。
- 归一在命令层完成，`prepareWork` 仍然只接受 `zh`／`en`：其它调用方（工具、提案）继续得到严格校验，不因命令的兼容读法放宽身份格式。
- 项目语言与 locale 层（`inkos.json`／`INKOS_DEFAULT_LANGUAGE`／`INKOS_LOCALE`／`LC_ALL` 等）登记为 D20：偿还路径是预设或插件配置提供默认语言，并按同一顺序解析；当前未实现。

### 建书与基础设定仍是两步

- 保留现有分工：`/story-init` 写身份、brief 与方向文档；基础设定由 `story_next` 指路，再由阶段或面板启动。
- 不登记为机制偏差：DSH 命令可以唤醒回合，源工程的一次性建书可以用命令后的 `agent.followup`／`steer` 等价实现，只是未实现。
- 登记 D19：偿还路径是命令写完身份后唤醒基础设定阶段，并补上异步反馈、幂等与失败回执；当前未实现，审计 `runtime.commands` 行仍判保真债。

### 重新立项的预检仍是拒绝

- 保留现有行为：`work.json` 已存在就拒绝，不删除工作区里的任何东西。
- 登记 D21：源工程会删除不完整作品目录后重建；DSH 的工作区根就是作品根，不能照搬 `rm -rf`。偿还路径是为不完整作品定义安全清理集（只清命令写入的身份、简报与方向文件）或显式 `force`，并覆盖失败回滚；当前未实现。

### 文档、证据与测试

- 更新既有 Note `2026-11-05-runtime-commands.md` 的全部过时事实：命令调用 `initWork`（不是 `writeWork`）、写 `brief.md`／`author_intent.md`／`current_focus.md`（不是「只有 `work.json`」）、`--genre`／`--platform` 已能进 `metadata`（旧篇「这两个参数不进本行」已过时）、用法行补 `--genre`／`--platform`／`--brief`、选项名与缺省、语言默认在 `prepareWork`、解析严格性的决定被本篇取代。旧篇改为指向本篇的选项与解析契约，避免两篇各自拥有一份事实。
- 更新 `docs/fidelity-audit.md` 的 `runtime.commands` 行：修正 `--lang` 描述，D3／D4 标为已偿还，登记 D19／D20／D21，判定仍为「保真债」（不改成「机制等价」）。
- 更新 `docs/scope.md` 的保真债表：删除 D3／D4 行，新增 D19／D20／D21 行。
- 不新增 `docs/dsh-mapping.md` 的建书拆分偏差行；D5（`--brief` 相对工作区根）保持原样。
- 跑 `pnpm run check-capabilities -- --write` 重生成账本；实现／消费者路径不变，`realRun` 指向重录后的回执。
- 重录 `artifacts/real-runs/runtime.commands.json`：行为已经变化，旧回执不能继续描述新行为。
- 测试覆盖：两个源名与两个别名、`--flag=value`、重复后者覆盖、缺省 genre／platform、数值前导整数、空值矩阵、`--lang` 归一与回退、`--brief` 与 `--` 标题规则不回归。

## Alternatives considered

- **只保留源名，删掉 `--chapters`／`--words`** — 最强理由：命令面与源 CLI 的选项名完全一致，别名越少越不容易产生歧义。否掉：现有提示、测试和真机回执都用短名；审计给出的偿还路径是补别名，不要求删；多接受一个别名不改变源行为。
- **只保留短名，不加源名** — 零改动。否掉：D3 原样保留；作者照源 CLI 敲 `--target-chapters` 会得到「未知选项」，这不是等价。
- **保留严格语法：整数字面量、重复选项报错、只认空格分隔** — 最强理由：错误更直接，`2.5` 不会被静默截成 2，重复参数不会被悄悄覆盖。否掉：用户裁决按源解析；数值收窄会改变写入 `metadata` 的产品数据，重复／等号属于命令语法，扩宽后可显式取代旧决定，不需要留成债。
- **补齐 `--title`，让选项面与源一一对应** — 最强理由：`--title` 是源命令的必填项，接受它才算选项面完整。否掉：标题已经由位置参数承载，两个来源会给「同时给出时用哪个」增加规则；入口形态差异由映射表的 CLI 行承接，不属于 D3 的规模选项问题。
- **保留严格 `--lang` 枚举，未知值报错** — 最强理由：报错直接，不会把 `fr` 静默写成 `zh`，作者不会误以为语言生效。否掉：源工程没有这条限制，静默回退是它的可观察行为；保留就是自创格式限制。
- **一条命令启动基础设定** — 最强理由：最接近源工程「一条命令建完」的体验。否掉：这条增量的范围只到选项面，D19 登记偿还路径；命令唤醒阶段的异步反馈、幂等与失败回执需要单独设计，塞进来会让范围失焦。
- **重新立项的安全清理** — 最强理由：源工程能从中断的基础设定恢复，作者不必手动删文件。否掉：工作区根就是作品根，清理规则、保留边界与失败回滚需要单独设计；D21 登记偿还路径，当前不引入破坏性操作。

## Consequences

命令的选项面现在与 `book create` 的可写字段对齐：源名与短别名、`--flag=value`、重复后者覆盖、`parseInt` 前导整数、空值矩阵、缺省 `xuanhuan`／`tomato`／200／3000／`zh`、`--lang` 前缀归一。旧 Note 的严格语法与「`--genre`／`--platform` 不进身份」两处事实已在同一批更新，旧篇指向本篇。

验证：`packages/see-dsh-novel/test/work-command.test.mjs` 的 17 例覆盖标题/选项/别名/内联值/重复覆盖/`parseInt`/空值/`--lang` 归一/`--brief`/错误矩阵；`pnpm run verify` 跑绿 286 例。真机回执在 `artifacts/real-runs/runtime.commands.json`：会话 `session-b5e96a1f-29b2-4204-9ed6-6738d65413c8` 的工作区 `E:\novelist\test-novel\t001` 里，`/story-init 《对齐验证》 --target-chapters=80 --chapter-words=2500 --lang=zh-CN` 落出 `metadata` `{ targetChapters: 80, chapterWordCount: 2500, genre: "xuanhuan", platform: "tomato" }` 与回执「目标 80 章，单章 2500 字，xuanhuan，tomato」。

代价与残余债：

- 默认 `xuanhuan`／`tomato` 会让没想过分类的作者得到两个具体值；这是源行为，不改成留空。
- `2.5` → 2、重复后者覆盖、`--lang fr` 静默回退都是源工程的可观察行为；采用后继承它们的意外性。
- D20：不读宿主 locale 与项目语言配置，未知 `--lang` 恒回退 `zh`；偿还路径是预设或插件配置提供默认语言并按同一顺序解析。
- D19：命令仍只写身份、brief 与方向文档，不启动基础设定；偿还路径是写完后通过 `agent.followup`／`steer` 启动基础设定阶段。
- D21：重新立项仍拒绝已有 `work.json`；偿还路径是为不完整作品定义安全清理集或显式 `force`。
- 审计 `runtime.commands` 行仍是「保真债」：D3／D4 已偿还，D19／D20／D21 未偿还，不能因为这条增量完成就判「机制等价」。
