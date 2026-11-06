# Agent Note: chapter.write —— 正文首版：writer 子代理与章节文档落盘

Status: proposed

## Problem

章纲已就绪，但正文还没有落点。源工程写一章由两部分组成：

- `WriterAgent`（`agents/writer.ts` + `writer-prompts.ts`）：把章纲、上下文、book rules、风格指南与字数契约交给写作 agent，产出正文；写作方法来自已激活的长篇写作 Skill，writer prompt 只承载治理契约（受控输入、篇幅、人称、主角规则、规则权威性）；
- 宿主落盘：章节文档写成 `source/chapters/NNNN_<Title>.md`，文件头是 `# 第N章 标题`（英文 `# Chapter N: Title`），正文是去掉标题行后的内容（`utils/chapter-document.ts`）。

复刻侧有章纲、上下文、检索与压缩，但没有任何写正文的入口。

## Proposal

### 写作：原生 subagent

主编不写正文。写作按 DSH 原生方式派发：

1. 主编加载已有的长篇写作 Skill（`longform-writing`）作为方法；
2. 主编用原生 `subagent` 派发 writer 任务，任务里带上：章纲（goal/body）、上下文包（protected + compressible）、`book_rules.md`、`style_guide`（存在时）、目标字数与语言、上一章结尾（存在时）；
3. 子代理返回纯正文（不含标题行，不含解释）；
4. 主编调 `story_write_chapter` 落盘。

不新增 writer prompt 拼装层；写作方法在 Skill 里，治理契约由工具校验。

### 落盘：`core/chapter-document.ts`

```ts
renderChapterDocument({chapter, title, content, language}): string
writeChapterDocument(root, input): Promise<{path, charCount}>
```

- 文件路径 `source/chapters/NNNN_<safeTitle>.md`；`safeTitle` 去掉路径分隔符与控制字符，空白压成 `-`；同名冲突时报错（同章只允许一份首版）；
- 文档头 `# 第N章 标题`（英文 `# Chapter N: Title`），正文去掉自带的标题行（`chapterDocumentBody` 的语义），末尾补一个换行；
- 一次原子写入（`commitFoundation` 单文件）。

### 工具：`story_write_chapter`

参数：`chapter`、`title`、`content`。

- 该章必须有 governed plan（`loadChapterPlan`），且 `chapter` 与 plan 一致；没有章纲拒绝；
- 该章章节文档已存在时拒绝（不覆盖首版；重写属后续修订能力）；
- `title` trim 非空、`content` trim 非空；`content` 不含一级标题（由工具统一加头）；
- 返回 `{chapter, path, charCount, target}`；`charCount` 用源工程的计数口径（中文按 CJK 字符、英文按词），`target` 来自作品 `chapterWordCount`；不因偏差拒绝，只在回执里给出偏差。

### 读取

`loadChapterDocument(root, chapter)`：返回 `{path, heading, content}`，按章号在 `source/chapters/` 下匹配 `NNNN_*.md`；缺文件返回 `null`。

## Alternatives considered

**主编直接写正文。** 省一次子代理。否掉：主编的职责是编排，正文写作在源工程是独立 agent；DSH 落点是 subagent。

**把 writer prompt 写成 TS 模块。** 否掉：写作方法在 Skill；治理契约放工具校验。

**章节文件直接写 `0001.md`（无标题后缀）。** 否掉：源工程的章节 artifact 路径是 `source/chapters/NNNN_<Title>.md`，continuity 也按这个前缀找章。

**写入时强制字数区间。** 更严格。否掉：源工程把篇幅作为创作约束并做后续校订；首版落盘只报告偏差，硬拒绝会让写作无法交付。

## Acceptance criteria

- `story_write_chapter` 在存在章纲、标题与正文非空时写出 `source/chapters/0001_<Title>.md`，文件头是 `# 第1章 标题`，正文与传入一致（去掉重复的标题行与首尾空白）。
- 没有章纲、章号与章纲不一致、章节文档已存在、标题或正文空白时拒绝，且不落盘。
- 返回 `charCount` 与源口径一致（中文按字符、英文按词），`target` 来自作品身份的 `chapterWordCount`。
- `loadChapterDocument` 往返一致；缺文件返回 `null`。
- 测试：`test/chapter-document.test.mjs` 覆盖渲染、标题清洗、计数、拒绝与读取；`test/host.test.mjs` 工具清单加 `story_write_chapter`。
- 实现与证据：implementation `packages/see-dsh-novel/src/core/chapter-document.ts`；consumer `packages/see-dsh-novel/test/chapter-document.test.mjs`；工具在 `src/pipelines/long/write-tool.ts`；realRun `artifacts/real-runs/chapter.write.json`。
- 真实运行：在 `work-empty-2` 会话里派发 writer 子代理写第 1 章，再用 `story_write_chapter` 落盘；核对文件路径、标题头、字数与回执；再用同一章号调一次确认拒绝。

## Risks

- 正文由 subagent 写，文风与源 WriterAgent 不同；落盘契约、路径与计数一致。
- 首版只报告字数偏差，不自动续写或压缩；篇幅校订留给 `chapter.review`／`chapter.revise`。
- 章节文件只支持首版；重写与版本历史属后续能力。
