# Agent Note: runtime.session-binding —— 作品身份与绑定

Status: implemented

## Problem

`story_next` 只会回答「未绑定」：它对任何工作区都返回 `{ work: null, phase: 'unbound', next: 'init' }`，`PHASES` 里也只有 `unbound`。作品在这套系统里没有身份文件——`source/story/` 下的设定、正文全都存在，但「这是哪部作品、什么语言、多少章、什么状态」只活在对话和面板的猜测里：面板用两个锚点文件猜「有没有作品」，导出与备份没有可靠的元信息可写，多会话之间也没有共同的锚。

参考工程给每部作品一份清单（`inkos:packages/core/src/harness/work-store.ts` 写在 `works/<id>/work.json`，结构见 `contracts.ts` 的 `WorkManifestSchema`：`version/id/title/profileId/language/status/lineage/artifacts/metadata/createdAt/updatedAt`），会话按 `bookId` 绑定到作品（`session-binding.ts` 把 session kind 映射成 profile 与 workId），命令都要求作品 id。本项目一个工作区就是一部作品，但同样需要这份身份与绑定。

## Decision

### `work.json` 放在工作区根

作品身份文件 `work.json` 直接躺在工作区根（与 `source/` 同级），因为内容已经在根下、一个工作区只有一部作品：

```json
{
  "version": 1,
  "id": "我的小说",
  "title": "我的小说",
  "profile": "longform-novel",
  "language": "zh",
  "status": "draft",
  "metadata": { "targetChapters": 120, "chapterWordCount": 3000 },
  "createdAt": "2026-11-04T08:00:00.000Z",
  "updatedAt": "2026-11-04T08:00:00.000Z"
}
```

与参考清单的差别，逐项写明：

- `profile` 对参考的 `profileId`：v1 只有长篇，值固定 `longform-novel`。
- 不写 `lineage` 与 `artifacts`：跨作品衍生与工件版本归 `artifact.identity` 行，现在没有消费方。
- 导出边界不由本文件承担：一个工作区一部作品，导出按工作区根打包，`work.json` 只是元信息。
- `language` 只认 `zh`/`en`；`status` 取 `draft`/`active`/`archived`，立项时 `draft`。
- `metadata.targetChapters` 与 `metadata.chapterWordCount` 可选，出现时必须为正整数。
- `id` 取工作区目录名，只作标识，**不参与任何路径拼接**——路径一律相对于工作区根。
- 解析严格：未知字段、版本不符、类型不对都报错，不静默补默认，报错里带文件与字段。

参考工程的多作品目录不照搬：一个工作区一部作品，`work.json` 在根而不是 `works/<id>/`。这替代了参考里 `works/<id>/work.json` 的身份与预设职责；多作品才需要换目录。

### 两个工具

- `story_work_create`：`title`（必填）、`language`（默认 `zh`）、`metadata.targetChapters`、`metadata.chapterWordCount`。已有 `work.json` 时报错，不覆盖。返回 `{ work: Work }`。
- `story_work_show`：无参，返回 `{ work: Work | null }`。`Work` 的 schema 子集：`version`、`id`、`title`、`profile`、`language`、`status`、`metadata`、`createdAt`、`updatedAt`；可空用 `oneOf: [{type:'object', …}, {type:'null'}]` 表达（运行时 schema 不接受 `type` 数组）。
- 两个工具遇到坏 `work.json` 都抛错，报错里带文件路径与字段名。

### 绑定：会话的工作目录就是作品根

「当前作品」不发散成一张 session→workId 的映射表：一个工作区就是一部作品，会话的当前工作目录就是作品根。

- 工具（`story_next`、`story_work_*`）用 `workingDirectory.ensure(agent)` 拿到**当前**工作目录，读 `<目录>/work.json`——读得到就是已绑定，读不到就是未立项。
- 面板走文件资源通道，那个通道按会话记录的目录解析路径，不是工作目录投影。作者显式改过工作目录之后，两者可能指向不同目录；这是既有资源通道的限制（现有两个锚点同样受影响），本行不为它新增假设，也不假装二者总是一致。`story_next` 与 `story_work_show` 是权威读数，面板只显示它探到的状态。

参考工程的 `session-binding.ts` 把 session kind 映射成 profile 与 workId；本项目的等价物是「预设 + `work.json.profile`」——预设决定用哪套工具，`profile` 字段记录作品类型，没有额外的绑定表要维护。

工具放在 `src/plugin/work-tools.ts`：作品身份是运行时级能力，`profile` 将来要用来选择长篇／短篇／剧本管线，不能长在 `pipelines/long/` 下面。

写入用新加的单文件原语 `commitFile(root, relativePath, content)`：同目录 `.tmp-<uuid>` 写完再 `rename`，失败时删掉临时文件。它和 `commitFoundation` 的差别要写清——后者服务多文件批量写，staging 放在 `source/.staging-<uuid>` 并有备份回滚；单文件写不需要备份，也不该为了写身份文件就先把 `source/` 建出来。两条路径各有一个消费方，共用同一个测试断言（目标文件内容正确、失败不留残留）。

### `story_next` 按文件说真话

`story_next` 从纯常量升级成「读文件再回答」。判据只看三个探针：`work.json`（W）、`source/story/outline/story_frame.md`（F）、`source/story/state/manifest.json`（M）。按下面的**顺序**判定，命中即止——所以四个阶段穷尽且互斥：

1. 三个探针都没有 → `unbound`，下一步 `story_work_create`
2. 没有 F → `foundation`（W、M 可有可无），下一步 `story_foundation_outline`
3. 有 F，没有 M → `draft`，下一步 `story_foundation_details`
4. 有 F，也有 M → `ready`，下一步 `story_gate`

先判「什么都没有」再判「没有 F」，是因为 details 段允许先播种 M 再写 F（`tools.ts` 里 details 会写 `state/manifest.json`）：M 在而 F 缺时属于「基础设定没写完」，不该被说成「未立项」。`work` 字段从 `null` 扩展成作品标题（`string | null`）。**输出 schema 要改**：`phase` 的枚举由 `PHASES` 生成，扩到四值；`host.test.mjs` 里对 `storyNext()` 与工具清单的断言同批更新。

「内容在、身份缺」是合法状态：F/M 都在而 W 缺失时阶段是 `ready`、`work` 为 `null`——现在的 `.artifacts/work-demo` 就是这种状态。它不因缺 `work.json` 而被说成「未立项」。

判断逻辑留在 `src/plugin/story-next.ts` 的纯函数 `storyNext(state)` 里，读盘由 `src/plugin/agent.ts` 的工具执行壳完成，两者分别可测；阶段判据本身在 `src/core/work.ts` 里读文件、给纯函数提供 `{ hasWork, hasFrame, hasState }`。

### 面板：保留现有闸门，身份是附加信息

面板的构建基线（DSH slots 注册、React/JSX、类型化 slot props、样式安装）由 `runtime.client-ui` 那一行交付；本行只在那个基线上改状态文案与身份提示，不碰构建方式。

现有面板的行为（任一锚点存在即可确认）已经验证过，本行不动它：

| 资源状态 | 作者看到 |
| --- | --- |
| 任一资源 `none`（文件通道不可用） | 「读不到工作区状态」，不显示按钮 |
| 任一资源 `loading` | 「正在读取工作区…」 |
| 两个锚点都 `failed` | 「尚未立项」+ 工作区路径；若有 `work.json` 则改说「已立项，还没有基础设定」 |
| 锚点 `live` | 现有的作者确认闸门；`work.json` 缺失时加一行提示「身份文件缺失」 |

`work.json` 只作为存在性探针：文件资源的 `useResource` 只给元数据（存在性、大小），读不到正文，所以面板**不显示标题**，也不解析 JSON；内容合法性由 `story_next`／`story_work_show` 报错，面板只回答「在不在」。

`test/client.test.mjs` 的「任一锚点足够」用例保持通过，另加一条「work.json 缺失时闸门仍在、并带身份提示」；`test/host.test.mjs` 的工具清单与 `storyNext()` 断言同批更新。

### 不改 foundation 的既有行为

foundation 工具不因缺少 `work.json` 而拒绝写入：那会把已经验证过的能力改成「必须先立项」，而立项入口（`proposal.creative`）还没落地。`story_next` 的阶段是指路牌，不是写入门禁；等提案行落地后再决定是否把排序变成硬约束。

### 与 `runtime.commands` 的关系

`next` 从 `'init'` 改成具体的工具名（`story_work_create` 等）。`runtime.commands` 那一行负责把这些动作暴露成斜杠命令或无头入口；本行只给工具，不给命令，两行的边界在 scope 的 P1 里已经写好。

## Alternatives considered

**把身份写进 `source/story/state/manifest.json`。** 少一个文件。否掉：`manifest.json` 是基础设定的产物，立项时还没有；身份必须先于内容存在，否则「未立项」和「设定写了一半」分不开。

**放到 `works/<id>/work.json`（照抄参考工程）。** 多作品、路径隔离。否掉：现有内容都在工作区根，照抄要把全部路径搬进 `works/<id>/`，是没有产品收益的迁移；一工作区一作品时目录名就是身份。

**身份只放会话投影、不落盘。** 零文件。否掉：换会话就丢，导出与备份拿不到元信息，正是当前的问题。

**`story_next` 直接返回完整作品对象。** 信息更全。否掉：面板读文件、导出读文件，`story_next` 只需告诉 agent「写到哪一步」；在输出里复制字段会多一处会过期的副本。

**立项即写入 `status: active`。** 少一次状态迁移。否掉：立项只代表「决定写这部」，开写是第 1 章定稿；`draft` 让导出与备份能区分草稿与在产。

**在面板里解析 `work.json` 显示标题。** 面板更好看。否掉：文件资源不带正文；为显示标题加一条读文件通道，超出本行范围。

## Consequences

身份与读文件：`src/core/work.ts` 定义 `WORK_FILE`、`WORK_VERSION`、三个枚举（`WORK_PROFILES`／`WORK_LANGUAGES`／`WORK_STATUSES`）、`Work`／`WorkMetadata`／`WorkProbes`、`parseWork`（严格：未知字段、版本、枚举、正整数、时间戳都按「文件 + 字段」报错）、`readWork`、`workProbes`（三个探针只看存在性）与 `writeWork`（校验输入、`id` 取目录名、`profile` 固定 `longform-novel`、`status: draft`、时间戳取同一次 `toISOString()`；已存在时先按内容报字段错，内容合法才报「不覆盖」）。`src/core/commit.ts` 新增单文件原语 `commitFile`：同目录 `.tmp-<uuid>` 写完 `rename`，失败删临时文件；它不建 `source/`，也不做备份——那是 `commitFoundation` 的职责。

阶段与工具：`src/plugin/story-next.ts` 的 `PHASES` 扩到 `unbound`／`foundation`／`draft`／`ready`，`NEXT_STEPS` 把阶段映射到 `story_work_create`／`story_foundation_outline`／`story_foundation_details`／`story_gate`；`storyNext(state)` 按「什么都没有 → 没有大纲 → 没有状态清单 → 全都有」的顺序判定，`work` 取读到的标题或 `null`，所以「内容在、身份缺」是合法的 `ready`。`src/plugin/work-tools.ts` 注册 `story_work_create`（参数 `title`／`language`／`metadata.targetChapters`／`metadata.chapterWordCount`，返回 `{ work }`）与 `story_work_show`（返回 `{ work: Work | null }`），两者都要求所属 agent、都用 `workingDirectory.ensure` 解析作品根。`src/plugin/agent.ts` 的 `story_next` 从常量升级为读盘：先 `workProbes`、再按需 `readWork`，坏文件直接抛错；它也因此需要所属 agent，无归属时直接报错。

面板：`StoryView` 增加第三个探针 `/work.json`，只当存在性信号（资源通道不带正文，不解析 JSON）。三个探针的通道状态合并判定：任何一个 `none` 就报「读不到工作区状态」、任何一个 `loading` 就报「正在读取」——身份通道读不到不等于身份缺失。通道可读之后，两个锚点都缺时按身份分成「尚未立项」与「已立项，还没有基础设定」；有基础设定时保留原有闸门，身份缺失只追加一行提示，按钮照旧。

验证见 `test/work.test.mjs`（写入字段与幂等、输入校验、严格解析的各类坏值、坏 JSON、探针真值表、四阶段映射、`commitFile` 残留、两个工具的创建／查看／拒绝覆盖、坏身份文件让两个工具报字段错、五个 schema 都在运行时子集内），`test/host.test.mjs`（工具清单扩到十个、`story_next` 在空工作区到 `ready` 的四级读数、卡片渲染）与 `test/client.test.mjs`（身份三态、任一锚点足够、通道不可用与闸门）；真实运行回执见 `artifacts/real-runs/runtime.session-binding.json`。

代价与已知限制：

- `work.json` 在根目录，`export.work` 与 `backup.restore` 必须把它算进产物清单，否则导出的作品没有身份。
- `id` 取目录名，只作标识；将来若有逻辑按 `id` 找目录，工作区改名就会断——这条限制要一直成立。
- `status` 目前没有推进路径（立项即 `draft`），推进属于章节定稿／导出的活。
- 面板读不到标题，只能显示状态；作者想确认作品名要回到对话。
- 作者显式改过工作目录之后，工具按当前目录、面板按会话记录目录，二者可能指向不同的 `work.json`；`story_next` 与 `story_work_show` 是权威读数，这条限制来自既有资源通道。
- 严格解析意味着手改 `work.json` 加字段会让 `story_next` 报错——这是想要的（宁可炸）。
- 两个写原语（`commitFoundation` 与 `commitFile`）并存；后续行若需要多文件事务，应复用前者而不是再写一个。
