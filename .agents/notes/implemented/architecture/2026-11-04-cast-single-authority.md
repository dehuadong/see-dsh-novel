# Agent Note: cast.single-authority —— 人物唯一权威与角色进入上下文

Status: implemented

## Problem

foundation 把角色卡分别写进 `roles/主要角色/` 与 `roles/次要角色/`，但没有定义「一个角色只有一张卡」：同一名字可以同时出现在两个档位；两个不同名字经安全化后可能落成同一个文件名（`乙/丙` 与 `乙_丙` 都变成 `乙_丙.md`，后写覆盖先写）；写章节的 agent 也完全拿不到角色卡——人物至今没有进入任何上下文。

参考工程把 `story/roles/` 当唯一来源，按档位分组渲染进上下文（`utils/outline-paths.ts` 的 `readRoleCards` 与 `readCharacterContext`，两个档位都渲染），但没有定义同名冲突、换档、空卡与读失败这些边界。本项目要补的正是这几条规则。

## Decision

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
  text: (assembly) => castTextFor(assembly),
})
```

`castTextFor` 在 `installCastContext` 里：先确认这次装配的 agent 属于本预设，再用 `workingDirectory.get(agent.session)` 读两个档位目录并渲染。

- `order: 130` 排在 team identity（125）之后、harness source（200）之前，不占用内置位置。
- `interpolate: false`：角色卡里出现 `{{...}}` 时按原文保留，不被当成提示变量。
- `required: true`：作者关掉可选 runtime context 时角色档案仍保留——没有它写不了正文。

文本由本次装配的 `AssembleContext.agent` 推出会话目录（`workingDirectory.get(agent.session)`；会话没有自己的目录时那是宿主默认目录），同步读两个档位目录。没有 agent、预设不符、或既没有卡也没有问题时返回空串，不贡献任何文本。

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

以上人物档案是唯一来源：已有角色不得改设定，新人物先建档再写。
```

最后一行是给模型的规则：人物档案只用来保持一致，不允许借它改写已有设定或凭空补人物。卡内容按文件原样拼接，不加二次标题，只去掉卡末尾的换行以免块之间出现多余空行；名册与卡片块都按名字的 Unicode 码位升序排列，保证同一磁盘状态每次装配产出同一段文字。

没有任何卡也没有问题时贡献为空；只剩问题时（例如唯一一张卡是空卡）仍然注入 `[cast-problem]`，让作者看得见。

### 只在 see-dsh-novel 的 agent 上生效

系统提示服务是根作用域的单实例，`context()` 把贡献登记在服务自己的 ctx 上：同一进程里别的 agent 装配时也会看到这条注册。所以文本提供函数先看 `agentPresets.composedPreset(agent.ctx)`，不是 `see-dsh-novel` 就返回空串；`agentPresets` 服务缺席时同样返回空串——宁可没有角色档案，也不串到别的预设。

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

## Consequences

收益：人物只有一个权威来源，同名、碰撞名和空卡在写入或装配时就被挡住；两个档位的角色卡都进入 runtime context，写作 agent 不再靠对话记忆人物；`roles:index` 与 `role:<name>` 给了后续检索与预算一个稳定键空间，而磁盘上不多一份会过期的索引。

`packages/see-dsh-novel/test/cast.test.mjs` 覆盖：两档读取与排序、空目录、名册与逐字卡块、同名冲突、空卡、仅空卡时的 `[cast-problem]`、目录读不了时的 `[cast-problem]`、上下文贡献的名字/位置/插值/必填标记、预设护栏与无卡目录、索引的三类拒绝、换档在 `init` 与 `revise` 下的删除（含去重）、空卡内容拒绝。

代价与已知限制：

- 每轮都重发整份角色卡：六张卡约几千 token，角色越多越贵；预算与裁剪归 `context.brief`。
- 同步读盘发生在每次装配：六个小文件可以接受，角色数量很大时要加按目录 mtime 的缓存。
- 作者手改文件仍可能造出空卡或冲突；系统只报告不修复，修复靠作者或重跑 `revise`。
- 预设判断依赖 `agentPresets.composedPreset`；该服务缺席时角色档案不会注入（宁可没有，不串预设）。
- 运行时上下文快照会出现在会话记录里，卡内容对作者可见（本来就是给模型看的）。
- 换档删除是 `init` 只写不删的唯一例外：同一角色换档位时旧卡必须消失，否则磁盘留下两张同名卡、整份人物档案都不再注入。这条例外登记在 [foundation-architect](2026-11-04-foundation-architect.md) 的写入语义里。
- 档位目录本身读不了（权限等）时也按 `[cast-problem]` 报告，而不是让整轮装配失败。
