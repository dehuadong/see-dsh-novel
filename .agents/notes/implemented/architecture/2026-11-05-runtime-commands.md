# Agent Note: runtime.commands —— 立项的命令行入口

Status: implemented

## Problem

作品身份现在只有一条写入路径：模型调用 `story_work_create`。面板只探 `/work.json` 在不在、不写身份，作者想新建作品必须先开一个会话、说一句话、等模型决定调工具——对「这部作品叫什么、什么语言、多少章」这种确定性输入，多了一层不必要的自由发挥。

参考工程把确定性动作交给命令：`inkos init [name] [--lang]` 初始化项目目录，`inkos book create --title … --lang … --target-chapters … --chapter-words …` 写作品清单。后者才是身份；`init` 的 `[name]` 是子目录名，不是标题。本项目一个工作区一部作品，两条命令合并成一条 `/story-init <标题> …`：在当前工作区写下 `work.json`。

DSH 的 command 是会话内的确定性入口；它仍然要求作者已经打开一个会话。无头（不打开会话、直接跑一次）需要项目自己的 CLI，本行不交付——解析函数是纯函数，将来无头入口复用同一段「解析 → `initWork`」。

> 选项名、解析、缺省与语言的本次对齐记录见 [runtime.commands 源对齐](2026-11-08-runtime-commands-compat.md)。

## Decision

### 命令形态

```
/story-init <标题> [--lang zh|en] [--target-chapters N] [--chapter-words N] [--genre 题材] [--platform 平台] [--brief 简报文件]
```

- 标题是必填的剩余文本：允许空格与书名号，首尾空白去掉；`--` 之后的内容按原文取回，内部空白保留。
- `--lang` 按源工程的前缀规则归一：`zh*` 归 `zh`、`en*` 归 `en`；其它写法回退到缺省 `zh`（由 `prepareWork` 落默认值）。
- `--target-chapters`／`--chapter-words` 是源 CLI 的选项名；`--chapters`／`--words` 保留为同义别名。取值按 `parseInt(value, 10)` 取前导整数，再交给 `prepareWork` 的 `positiveInteger`。
- `--genre`／`--platform` 进 `work.json` 的 `metadata`；未给时落源 CLI 的缺省 `xuanhuan`／`tomato`。
- `--brief` 读工作区根下的文件；`--brief=` 视为没给简报，指令用 `Create <标题>`。

命令名沿用现有前缀风格（`story-approve` 等），不叫 `init`：短名在同一条命令面里更容易撞。

注册时声明 `input: { hint: … }`：DSH 的命令描述符用 `input` 告诉输入框「这个命令收自由文本」，不声明时选中命令即派发，作者没有机会补参数。参数仍由 `parseWorkCreate` 解析。

### 作者入口仍是对话

命令不是作者日常的立项入口：正常流程里作者说清楚要写什么，模型自己判断并调用 `story_work_create`；命令是同一个写入的确定性入口，给自动化、无头调用与将来 CLI 用，也让作者在明确知道标题与规模时一次写完。真机验证里模型就是自己完成立项的（它拿到一句自然语言，读了 `work.json` 与工具，然后调了 `story_work_create`）——这条路径不因为多了命令而改变。

### 解析与校验各管一段

`parseWorkCreate(rawInput: string): WorkCreateArgs`（`work-command.ts`）只做**语法**：切词、认选项、要求标题非空（空标题就是缺参数）、同时接受 `--flag value` 与 `--flag=value`、数值按源 `parseInt(value, 10)` 取前导整数、未知选项报错；同一选项重复时后者覆盖前者。语法错误抛 `Error`，消息点名参数（如 `--chapters 取不出整数`）。选项表把「取值校验 + 落点」放在一项里，新增选项只改这张表。

**语义**留给 `prepareWork`／`initWork`：语言枚举、正整数、目录与 `work.json` 的读写冲突都由它负责（`core/work.ts`）。标题非空两边都会检查——解析层是「有没有这个参数」，`initWork` 是「写进去的值是不是空的」。命令层只做兼容读法（`--lang` 的前缀归一），不重复枚举与数值规则；不认识的写法回退缺省值，所以 `--lang fr` 不再报错，而 `--genre=`／`--platform=` 这类空值仍由 `prepareWork` 的空字符串校验拒绝。

`WorkCreateArgs` 是解析结果：标题与五个选项名和 `WorkCreateInput` 同名，但类型不同（这里已经是 `string`／`number`），另带 `brief`；`WorkCreateInput` 另有 `minChapterLength`／`maxChapterLength`。

```ts
type WorkCreateArgs = {
  title: string
  language?: string
  targetChapters?: number
  chapterWordCount?: number
  genre?: string
  platform?: string
  brief?: string
}
```

抛出与捕获：命令处理器把 `workingDirectory.ensure`、`parseWorkCreate` 与 `initWork` 一起包在 `try/catch` 里（所以工作区解析失败也落成一条命令错误，而不是把异常交给宿主渲染），`catch` 返回 `{ kind: 'error', text }`，`text` 取 `Error.message`、非 `Error` 的值用 `String(error)`。成功的输出见下。命令的 kind 由处理器显式决定，测试才能断言。

### 行为

1. `workingDirectory.ensure(invocation.agent)` 取当前工作区；解析结果为空时报错；
2. `parseWorkCreate(invocation.rawInput)`；
3. `initWork(root, args, instruction)`：身份、`story/brief.md` 与方向文档同一次提交；
4. 成功返回：

```
已立项《夜行测试》：longform-novel，zh，draft（目标 80 章，单章 2500 字，xuanhuan，tomato）
下一步：让主编按 story_next 的指示写基础设定，或在「作品」面板点「开始基础设定」。
```

身份那一行由 `core/work.ts` 的 `describeWork` 生成（工具卡片与命令回执共用）；标题已经带书名号时不再包第二层。已经立项的工作区再敲一次，转出 `initWork` 的「已经存在，不覆盖」；坏 `work.json` 转出字段错误。

### 不唤醒会话

命令只写文件、返回文本，不投消息、不起一轮。`/story-init` 是作者对「这部作品叫什么」的确定回答，写完就结束；要不要马上开写由下一步决定（面板的「开始基础设定」或对话里说一句）。这与 `/story-approve` 依赖 `panel.gate-resume` 才继续是同一个形状。

源工程 `book create` 会在同一条命令里启动基础设定；这里是两步流程，差异登记为 D19 债，偿还路径见 [runtime.commands 源对齐](2026-11-08-runtime-commands-compat.md)。

### 归属与作用域

放 `src/plugin/work-command.ts`，与 `work-tools.ts` 同级：立项是运行时级能力。`agent.ts` 注册它并并入现有注销（先注销后注册的 `work-tools`，再注销命令）。它和 `story_*` 工具一样只在 `see-dsh-novel` 预设的会话里可见——不是全局命令面；同一会话里可能撞名的是同一预设挂载的其它命令。

## Alternatives considered

**只靠 `story_work_create` 工具，不加命令。** 零新增面。否掉：确定性输入不该经过一次模型判断；参考工程也是命令优先。

**把命令做成工具的薄包装，`rawInput` 直接透传。** 少一层解析。否掉：命令的输入是一整行文本，没有 schema；不解析就把 `--lang` 当标题的一部分写进 `work.json`。

**命令自己校验语言与章数，给出更贴合命令的帮助文案。** 报错更好看。否掉：同一套规则会出现两份，改一处漏一处；命令层只保留 `--lang` 的兼容归一，枚举与数值仍由 `prepareWork` 兜底。

**命令写完顺手投一条「开始写基础设定」。** 少一步。否掉：立项与开工是两个决定；`panel.foundation-start` 已经把「开写」做成显式动作。

**用短名 `init`。** 与参考工程一致。否掉：同一条命令面里通用词更容易撞。

## Consequences

`src/plugin/work-command.ts` 导出 `COMMAND_INIT`（`story-init`）、`WorkCreateArgs` 与纯函数 `parseWorkCreate`：切词带位置、认 `--lang`／`--target-chapters`／`--chapter-words` 及其别名、`--` 之后按原文取回标题、数值按 `parseInt` 取前导整数、支持 `--flag=value` 与重复后者覆盖，错误按参数点名。`installInitCommand(ctx)` 注册命令，处理器把 `workingDirectory.ensure`、解析与 `initWork` 一起包在 `try/catch` 里，异常与语义错误都转成 `{ kind: 'error', text }`，成功时用 `describeWork` 输出身份与下一步提示。`src/plugin/agent.ts` 注册并在注销链里按相反顺序收尾；`describeWork` 由 `core/work.ts` 拥有（工具卡片与命令回执共用），已经带书名号的标题不再包第二层。

验证见 `test/work-command.test.mjs`（解析的标题/选项/别名/内联值/重复覆盖/`parseInt`/空值/`--lang` 归一/`--`/错误分支、命令写盘与逐字回执、默认缺省、第二次立项与坏 `work.json`、语法与语义错误都不写文件）与 `test/host.test.mjs`（命令清单四条）；`test/work.test.mjs` 另有「标题已带书名号不再包第二层」的工具卡片断言。真实运行回执由 Verify 阶段写到 `artifacts/real-runs/runtime.commands.json`；回执要能看出 `/story-init` 的成功文本与 `work.json` 落盘，以及随后的 `story_next` 阶段与面板状态。

代价与已知限制：

- 标题里出现 `--lang` 这类字样会被当成选项：用 `--` 分隔兜底，但作者要知道这条规则。
- 命令只写身份、`story/brief.md` 与方向文档，不写基础设定；空工作区敲完目录里还没有大纲、规则与角色卡（由基础设定写）。
- `--target-chapters`／`--chapter-words`（及 `--chapters`／`--words`）没有上限约束，作者写多少记多少；数值按 `parseInt` 截断，`2.5` 会记成 2。
- `--lang` 不认识的写法静默回退 `zh`，不读项目语言配置与宿主 locale；这两层登记为 D20。
- 源工程一次命令启动基础设定、重新立项会删除不完整作品目录；这里是两步流程、已有 `work.json` 一律拒绝，分别登记为 D19、D21。
- `profile` 固定 `longform-novel`：命令在短篇预设的会话里也能敲（只要那个预设挂了这个插件），但记下的仍是长篇类型；短篇落地时按预设取值，属于那一行。
- 无头入口没有交付：要跑 `/story-init` 仍要打开会话；解析函数无副作用，将来 CLI 直接复用。
