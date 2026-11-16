# Agent Note: foundation.architect —— 角色卡提交失败时的错误文案

Status: implemented

## Problem

真实会话 `session-607ecdcb-5e6d-44ff-8c29-3a75c09fe026`（工作区 `E:\novelist\test-novel\t001`）里，模型连续 5 次调用 `story_foundation_cast_documents`，前 4 次失败：

| step | 参数 | 结果 |
|---|---|---|
| 9 | `{mode:"init"}` | 角色卡内容不能为空：苏晚星 |
| 13 | `{mode:"init"}` | 同上 |
| 19 | `{mode:"init", cards:"[{…}]"}`（数组当字符串） | 同上 |
| 22 | `{mode:"init"}` | 同上 |
| 23 | `{mode:"init", role_1_content:"…"}` | 写入 11 个文件 |

契约与源一致（见下节），失败集中在两点：

1. **错误只报第一张缺卡。** 校验逐张抛错，第一张空卡就中断；模型看不到还缺哪几张，也不知道按什么形状重试，于是去写 `roles/major/苏晚星.md`（见 [`2026-11-16-cast-reads-four-role-dirs.md`](../../proposed/bug-fix/2026-11-16-cast-reads-four-role-dirs.md)）并翻宿主安装目录（见 [`2026-11-16-out-of-workspace-reads.md`](../../proposed/architecture/2026-11-16-out-of-workspace-reads.md)）。
2. **描述没有点明「按具名字段提交」。** 复刻原描述是 `Write one character card per indexed role under source/story/roles/`，源是 `Submit each character card as text in its named field.`——源这句直接说清提交形状。

## 源工程证据

- 源就是同一套四段拆分与动态字段：`inkos/packages/core/src/agents/architect.ts:318-333`，`:331` 的调用描述是 `Submit each character card as text in its named field.`，参数由 `foundationCastDocumentsToolSchema(cast.roles)` 生成，`:333` 用 `cards[\`role_${index+1}_content\`]` 取值。
- 字段 schema：`inkos/packages/core/src/agents/architect-tool.ts:43-48`，每个角色一个 `role_N_content`，`Type.String({minLength:1, description: 'Concise Markdown card for ${role.name}: … Submit text directly.'})`，`additionalProperties:false`。
- 结论：一次调用、逐人字段、非空都是源行为；复刻缺的只是说明与报错——DSH 不会替我们按 schema 拦缺字段，缺卡落到执行期，而执行期错误没有把 schema 已表达的东西说出来。

## Decision

- 工具描述改为源的语义并点明形状：一次提交全部已索引角色，字段 `role_1_content`…`role_N_content`，顺序同 `cast_index`；`mode=revise` 删除不在本次提交里的旧卡；换档在两种模式下都会删旧卡。
- 逐字段描述（中文，与邻居一致）追加「缺这张卡或内容为空时，整次调用失败」。
- 校验先收集全部缺失项再一次性抛错：`缺少 N 张角色卡：role_1_content（姓名）、…；请一次提交全部已索引角色`；一次调用只产生一条错误，且**在写盘前**抛出。
- `stages/index.ts` 的 foundation 协议第 4 步（中英）原位追加字段与「一次提交全部」的说明，保留原有卡片内容要求与字数规格（`150–250`／`80–120`）。
- 参数形状、工具名、`cast_index`、`revise` 的删除集合与角色目录读取都不变。

## Design

- `tools.ts`：`submitted = indexedRoles.map(role => ({ role, field, content }))` 一次算出字段名与内容，`missing` 由其过滤，写盘再由同一批 `submitted` 生成——字段名与 `trim()` 只算一次。
- `contract.ts`：字段描述追加失败语义；`mode` 的描述从「删除本次未重写的角色卡」改为「删除不在本次提交里的旧角色卡」，与「缺卡整次失败」不再矛盾。
- `stages/index.ts`：只改 foundation 分支第 4 步，不动 `common`（`common` 的改动留给工作区读取边界项）。
- 验证切入点：`test/cast.test.mjs`（单张缺失、部分缺失、全缺、部分 `revise` 被拒、工具与字段描述断言）、`test/stage-context.test.mjs`（中英协议断言）。

## Alternatives considered

- **改成 `cards: [{name, content}]` 数组。** 最强理由：模型第一次就试了 `cards`，数组更符合直觉、不受索引顺序约束。否掉：源就是动态具名字段（`architect-tool.ts:43-48`），换形状偏离源并要重做 `revise` 的匹配；本次失败是文案问题。
- **只在错误里补「请按 schema 提交」。** 最强理由：改动最小。否掉：模型已拿到 schema 仍猜错，泛泛指路无新信息。
- **缺卡时读盘上已有卡兜底。** 最强理由：模型已用 `story_truth_file` 写过卡，兜底立即可成。否掉：混合「本次提交」与「旧卡」，架空 `revise` 删除语义，掩盖缺项。

## Consequences

- 模型第一次调用就能从描述与错误里知道要提交什么；真实会话里那次 5 连试的症状（反复 `{mode}`、试 `cards` 数组）失去成因。
- 行为变化：`mode=revise` 的「只提交改动的那几张」现在会被拒绝——因为缺字段整次失败，而旧实现允许部分提交并删掉未提交的卡。这正是「一次提交全部」的代价；若作者要恢复选择性提交，需要新的契约（例如允许省略字段并显式声明删除名单），属另立工作项。
- 缺卡错误一次列全，最多 11 条「字段（姓名）」；约 300 字符，远低于工具结果裁剪阈值。
- 账本与证据：`foundation.architect` 与 `runtime.stage-context` 两行同批重录 real-run（本项跨两行：工具文案属前者，协议一句属后者），PR 说明里单列；`docs/scope.md` 的 AU-12 其余子项不因本项关闭。
- 审计：`foundation.architect` 仍判保真债 AU-12（本项只关闭「契约不可发现」这一条）；`runtime.stage-context` 仍判机制等价。
- 真实会话观察（「不再重试超过 1 次」）在本环境取不到真实 DSH 会话，记 BLOCKED，不冒充已验证。
- Implementation Review 的两条实质发现已修：工具与字段描述此前没有断言（已补）；`mode` 描述与「缺卡整次失败」矛盾、换档删除只在 revise 生效的表述与 `movedRoleCards` 无条件运行不符（已改）。

## Testing

- `test/cast.test.mjs`：单张空卡、部分缺失（列 2 张）、全缺（列 3 张）、部分 `revise` 被拒且旧卡未被删、工具描述与 `role_1_content` 字段描述断言。
- `test/stage-context.test.mjs`：中英协议都含 `role_1_content`、一次提交全部（`submit every role in one call`）与字数规格。
- `pnpm run verify`：见 `artifacts/real-runs/foundation.architect.json` 的当前计数。
