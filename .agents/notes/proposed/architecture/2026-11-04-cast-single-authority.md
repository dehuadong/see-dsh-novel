# Agent Note: cast.single-authority —— 人物唯一权威与角色进入上下文

Status: proposed

## Problem

foundation 把角色卡分别写进 `roles/主要角色/` 与 `roles/次要角色/`，但没有定义「一个角色只有一张卡」：同一名字可以同时出现在两个档位；两个不同名字经安全化后可能落成同一个文件名（`乙/丙` 与 `乙_丙` 都变成 `乙_丙.md`，后写覆盖先写）；写章节的 agent 也完全拿不到角色卡——人物至今没有进入任何上下文。

参考工程把 `story/roles/` 当唯一来源，按档位分组渲染进上下文（`utils/outline-paths.ts` 的 `readRoleCards` 与 `readCharacterContext`，两个档位都渲染），但没有定义同名冲突、换档、空卡与读失败这些边界。本项目要补的正是这几条规则。

## Proposal

### 名字是身份，档位是属性

`source/story/roles/{主要角色,次要角色}/*.md` 仍是人物唯一来源，路径不变。

- `story_foundation_cast_index` 在生成下一段 schema 之前拒绝：空名、列表内重复名、安全化之后同文件名的两个角色——否则两张卡会写进同一个文件。
- `story_foundation_cast_documents` 拒绝空卡内容（全是空白的卡等于没有卡）；写某个名字时，若另一档位已存在同名卡，把旧文件加进本次删除清单：换档是移动，不是复制。`init` 与 `revise` 都生效，删除清单去重。
- 读取方（上下文注入）遇到同名跨档位、空卡或读失败：出问题的那张不注入，改为在同一条贡献里注入 `[cast-problem]` 点名；其余卡照常注入。

### 角色进入上下文

由 `see-dsh-novel/agent` 注册一条 runtime context：

```
systemPrompt.context({
  name: 'story:cast',
  order: 130,
  interpolate: false,
  required: true,
  text: (context) => renderCastContext(context.agent),
})
```

- `order: 130` 排在 team identity（125）之后、harness source（200）之前，不占用内置位置。
- `interpolate: false`：角色卡里出现 `{{...}}` 时按原文保留，不被当成提示变量。
- `required: true`：作者关掉可选 runtime context 时角色档案仍保留——没有它写不了正文。

文本由本次装配的 `AssembleContext.agent` 推出会话目录（`workingDirectory.get(agent.session)`），同步读两个档位目录。没有 agent、没有会话目录、或没有任何卡时返回空串，不贡献任何文本。

形态是 `roles:index` 名册加每卡一个 `role:<name>` 块：

```
## 人物档案（唯一来源：source/story/roles/）

[roles:index]
主要角色：沈砚、裴照、苏芜、崔无咎
次要角色：韩九、小满

[role:沈砚]
# 沈砚
（卡原文，逐字保留，不裁剪、不改写）

[role:韩九]
# 韩九
（卡原文）

[cast-problem]
沈砚在主要角色与次要角色各有一张卡：合并成一张再继续；冲突的卡没有注入。
```

卡内容按文件原样拼接，不加二次标题、不做行尾裁剪；名册与卡片块都按名字的码位升序排列，保证同一磁盘状态每次装配产出同一段文字。

### 只在 see-dsh-novel 的 agent 上生效

`systemPrompt.context` 注册落在服务根作用域、是全局的：同一进程里别的 agent 装配时也会看到这条注册。所以文本提供函数先看 `agentPresets.composedPreset(agent.ctx)`，不是 `see-dsh-novel` 就返回空串；`agentPresets` 服务缺席时同样返回空串——宁可没有角色档案，也不串到别的预设。

### 不落盘索引

`roles:index` 是每次装配时从卡文件算出来的派生名册，不是文件。文档仍是唯一权威，与「作品内容落盘为文档，索引是派生」一致。`foundation-architect` 把「`roles:index` 这类索引工件」留给本能力定义：这里把它定义成上下文键空间 `roles:index` 与 `role:<name>`，不落盘。

### 非目标

- brief 的预算、裁剪与 trace（`context.brief`）
- 角色检索（`context.retrieval`）
- 角色随章节变化的状态（`chapter.settle`）
- 面板展示角色（`panel.*`）

## Alternatives considered

**落盘 `roles/index.json`。** 读取方少扫几个文件。否掉：多一份会过期的副本，与「文档权威、索引派生」冲突；六张卡目录的扫描成本可以忽略。

**角色卡改名成 `role-<id>.md` 做身份。** 改名不影响身份。否掉：作者可读性与导出路径都变差，还会打破已定的路径契约，导出与备份要多一层映射。

**用 `systemPrompt.section()` 而不是 `context()`。** 系统提示缓存前缀更稳。否掉：项目铁律与账本都指定 `context()`；角色卡随作者编辑变化，放进缓存前缀等于每次改卡都要改缓存。

**只注入主要角色。** 上下文更省。否掉：参考工程两个档位都注入；缺了次要角色的卡，模型会自行补设定，前后不一致。

**冲突时静默挑一张（按档位或路径排序）。** 总比没有强。否掉：等于替作者决定谁是真的，而且排序一变结果就漂。

**把 `[cast-problem]` 通过工具错误抛出。** 更显眼。否掉：装配期抛错会打断整轮对话；作者需要的是「先看到问题、其余人物照常可用」。

## Acceptance criteria

- 上下文快照包含 `[roles:index]`，主要与次要角色都出现在名册里；每张卡一个 `[role:<name>]` 块，内容与文件逐字一致。
- 没有任何角色卡时该贡献为空：快照里不出现 `人物档案`。
- 同名跨档位时：冲突的两张卡不注入，快照里出现 `[cast-problem]` 并点名；其余卡照常注入。
- `story_foundation_cast_index` 拒绝空名、重复名、安全化后同文件名。
- `cast_documents` 拒绝空卡内容；把角色换档写入后，旧档位同名文件被删除（`init` 与 `revise` 都如此），磁盘上不留两张同名卡。
- 非 `see-dsh-novel` 预设的 agent 装配时该贡献为空（单元测试覆盖）。
- 真实运行：在 `.artifacts/work-demo` 的 see-dsh-novel 会话里发一条消息，会话日志的 runtime-context 快照含两个档位的卡与全部 `role:*` 键。

## Risks

- 每轮都重发整份角色卡：六张卡约几千 token，角色越多越贵；预算与裁剪归 `context.brief`。
- 同步读盘发生在每次装配：六个小文件可以接受，角色数量很大时要加按目录 mtime 的缓存。
- 作者手改文件仍可能造出空卡或冲突；系统只报告不修复，修复靠作者或重跑 `revise`。
- 预设判断依赖 `agentPresets.composedPreset`；该服务缺席时角色档案不会注入（宁可没有，不串预设）。
- 运行时上下文快照会出现在会话记录里，卡内容对作者可见（本来就是给模型看的）。
