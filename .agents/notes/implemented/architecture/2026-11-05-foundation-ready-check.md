# Agent Note: foundation.ready-check —— 就绪判据对齐「五段齐全 + 一张角色卡」

Status: implemented

## Problem

`story_next` 现在把「基础设定完成」判成三件事：`work.json`、`story_frame.md`、`state/manifest.json` 都存在（`core/work.ts:184-196`、`plugin/story-next.ts:42-56`）。源工程的判据是六份文件加一张角色卡：`book.json`、`story/outline/story_frame.md`、`story/outline/volume_map.md`、`story/book_rules.md`、`story/book_rules.json`、`story/pending_hooks.md`，外加 `story/roles/{主要角色,major,次要角色,minor}` 任一目录里至少一张 `.md`（`utils/outline-paths.ts:11-47`）。

两者差异会让复刻过早报 `ready`：

- 只写了大纲、没有 book rules／伏笔池／角色卡的工作区会被判完成；
- 反过来，`manifest.json` 不是源工程判据的一部分，用它当必要条件会把「状态文件还没播种、但真值文件齐全」的工作区挡在 `ready` 外。

`ready` 是面板与后续章节推进的入口，判早了会让章节规划读到空规则与空角色表。

## Decision

### 探针改成源工程那份清单

`core/work.ts` 的 `workProbes` 从三个布尔扩成一组：

```ts
export interface FoundationProbes {
  hasWork: boolean
  hasFrame: boolean
  hasVolumeMap: boolean
  hasRulesMd: boolean
  hasRulesJson: boolean
  hasPendingHooks: boolean
  hasRoleCard: boolean
}
```

`hasRoleCard` 依次看 `主要角色`／`major`／`次要角色`／`minor` 四个目录，任一目录里存在 `.md` 即为真；目录不存在按空处理，其它读取错误照常抛出。`manifest.json` 不再是就绪条件。

### 阶段仍保持四格，语义按源工程收紧

`plugin/story-next.ts` 的逻辑：

| 情形 | 阶段 | 下一步 |
| --- | --- | --- |
| 七个探针全为假 | `unbound` | `story_work_create` |
| 缺 `story_frame.md` 或 `volume_map.md` | `foundation` | `story_foundation_outline` |
| 大纲齐全，但缺 book rules md/json 或 `pending_hooks.md` | `draft` | `story_foundation_details` |
| 大纲与 book rules／伏笔池齐全，但没有角色卡 | `draft` | `story_foundation_cast_index` |
| 六份文件与角色卡齐全 | `ready` | `story_gate` |

`draft` 这个名字保留（四格是现有公开词表），但 `next` 在 `draft` 里要区分「补规则」与「补角色卡」：角色卡由 `story_foundation_cast_index` → `story_foundation_cast_documents` 两步写入，指到 details 会让路牌原地打转。

### 与面板和闸门的关系

- 面板的「有没有基础设定」按同一份文件清单判断：订阅 `work.json`、`story_frame.md`、`volume_map.md`、`book_rules.md`、`book_rules.json`、`pending_hooks.md` 六个锚点，六个都 live 才算有设定；不再用 `manifest.json`，也不再是「大纲或状态有一个就算」；
- 面板数不了角色卡：客户端资源通道按路径订阅，没有列目录能力，`story/roles/` 下有哪些文件客户端不知道。因此面板判「文件齐全」而不是「就绪」，`ready` 只由 `story_next` 判；这是 DSH 客户端机制的强制偏差，登记在 `docs/dsh-mapping.md`；
- `ready` 变严之后，面板的签核仍由 `story_gate` 决定，不会因为面板认为「设定齐全」就放行；
- `story_gate` 的签核条件（工件非空 + 摘要 + 作者确认）不变；本行只让路牌与面板说真话。

## Alternatives considered

**保留现有三探针，只在 `ready` 前额外查角色卡。** 改动最小。否掉：book rules 与伏笔池同属源工程判据，漏掉它们仍会过早 `ready`；而且 `manifest` 不是源工程条件，留着是双重标准。

**把 `manifest` 也保留为就绪条件。** 更保守。否掉：源工程不要求它；`details` 段已经保证播种，但作者手删 `manifest` 后真值文件齐全却判不完成，属于把索引当成作品事实。

**新增第五个阶段（如 `foundation-cast`）。** 语义更细。否掉：`next` 已经能在 `draft` 内区分下一步工具，扩阶段词只会让调用方多一个分支；四格够表达「还没立项／写大纲／补设定／可签核」。

**把判据放进 `story_gate`，`story_next` 不动。** 少改路牌。否掉：`ready` 本来就是路牌的职责；闸门管「作者确认」，两者混在一起会让「为什么不能签核」变得不可解释。

## Consequences

收益：就绪判据与源工程同一份清单——六份文件加至少一张角色卡。`story_next` 在缺规则时指 `story_foundation_details`，只剩角色卡时指 `story_foundation_cast_index`，不再原地打转；面板订阅同样六份文件，「大纲或状态任一个」的或判断与 `manifest.json` 锚点删掉，作者看到的是「设定齐没齐」而不是「有没有某一份索引」。

落地：`packages/see-dsh-novel/src/core/work.ts`（七项 `FoundationProbes`、`workProbes`、四层角色目录）、`src/plugin/story-next.ts`（四阶段与 `CAST_INDEX_STEP`）、`src/client/StoryView.tsx`（六份文件锚点）。

验证见 `test/ready-check.test.mjs`（七项判据、四个角色目录、只认 `.md`、`manifest` 单独不算就绪、没有 `manifest` 也能就绪、`draft` 两种 next）、`test/work.test.mjs`（探针逐项点亮、四阶段阶梯）、`test/host.test.mjs`（真机工作区从 `foundation` 到 `draft` 到 `cast_index` 到 `ready`）、`test/client.test.mjs`（六锚点、缺一份就不算有设定）。

### 代价与已知限制

- 角色卡只数 `.md` 文件，不校验内容；空文件也算一张，与源工程一致。
- 四个目录名同时认中文与英文；复刻只写中文目录，英文目录兼容历史文件。
- 面板判「六份文件齐全」，不数角色卡；`ready` 只由 `story_next` 判，偏差已登记在 `docs/dsh-mapping.md`。
- `runtime.load`／`runtime.session-binding` 的回执里仍写着旧探针口径（三个探针）；两行状态不依赖该描述，重读回执时需知道探针清单已由本行更新。
- `draft` 在源工程没有对应词，是复刻的路牌词汇；含义以上表为准。
