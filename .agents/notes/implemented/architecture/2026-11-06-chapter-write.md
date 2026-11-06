# Agent Note: chapter.write —— 正文首版：writer 子代理与章节文档落盘

Status: implemented

## Problem

章纲已就绪，但正文没有落点。源工程由 `WriterAgent`（`agents/writer.ts` + `writer-prompts.ts`）把章纲、上下文、book rules、风格指南与字数契约交给写作 agent，产出正文；宿主把章节写成 `source/chapters/NNNN_<Title>.md`，文件头是 `# 第N章 标题`（英文 `# Chapter N: Title`），正文是去掉标题行后的内容（`utils/chapter-document.ts`）。

## Decision

写作仍由模型 + 原生 `subagent` 完成：主编按 `write` 阶段协议派发 writer，任务里带章纲、上下文、book rules、风格指南、目标字数与语言；子代理只返回正文。创作方法由 `longform-writing` 主动注入（`runtime.stage-context`），本行不新增 prompt。

`packages/see-dsh-novel/src/core/chapter-document.ts`：

- `safeChapterTitle`：去掉路径分隔符与控制字符，空白压成 `-`；
- `chapterHeading`：`# 第N章 标题`／`# Chapter N: Title`；
- `chapterBody`：去掉正文自带的一级标题与首尾空白；
- `renderChapterDocument`：标题 + 空行 + 正文 + 末尾换行；
- `countChapterLength`：中文按 CJK 字符、英文按词；
- `writeChapterDocument`：路径 `source/chapters/NNNN_<Title>.md`；同章已有文件时拒绝；一次 `commitFoundation` 写入；
- `loadChapterDocument`：按章号前缀匹配，返回标题行与正文；缺文件返回 `null`。

`src/pipelines/long/write-tool.ts` 的 `story_write_chapter(chapter, title, content)`：要求该章有 governed plan（没有则拒绝），`title`／`content` 非空（由文档模块校验），同章已有正文拒绝；返回 `{chapter, path, charCount, target}`，`target` 来自 `work.metadata.chapterWordCount`；字数偏差只报告不拒稿。

## Alternatives considered

**主编直接写正文。** 否掉：正文写作在源工程是独立 agent，DSH 落点是 subagent。

**把 writer prompt 写成 TS 模块。** 否掉：创作方法由阶段上下文主动注入；治理契约放工具校验。

**章节文件写 `0001.md`（无标题后缀）。** 否掉：源工程的章节 artifact 路径是 `source/chapters/NNNN_<Title>.md`。

**写入时强制字数区间。** 否掉：篇幅是创作约束，首版只报告偏差；校订留给审阅与修订。

## Consequences

收益：writer 的正文可以落成带规范标题的章节文档；章纲缺失、重复写入会被拒绝；字数按源口径报告。

验证见 `test/chapter-document.test.mjs`（标题、正文去标题行、路径安全、计数、重复拒绝、读取往返）与 `test/host.test.mjs`（工具清单）。

代价与已知限制：

- 文风取决于 writer 子代理；落盘契约、路径与计数一致。
- 只支持首版；重写与版本历史属后续能力。
- `charCount` 只统计 CJK 字符／英文词，标点不计。
