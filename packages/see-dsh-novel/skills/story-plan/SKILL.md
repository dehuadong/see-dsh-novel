---
name: story-plan
description: 把一章的上下文编译成章纲（goal + 可读计划），并落成 governed plan 与 intent 投影。
whenToUse: 基础设定已签核、要规划下一章时加载；上下文包已经由 story_context_package 组装好。
---

# 章前规划

规划只做一件事：把已经选好的上下文编译成一份**可执行的章纲**，不写正文。

## 顺序

1. `story_context_candidates`：拿到本章候选与 composer 指令；
2. 原生 `subagent`：把指令与候选交给 composer，拿回 `{memory, role, state, outline}` 的 id 集合；
3. `story_context_package`：把 selection 交给宿主，得到 package 与 trace（超预算时再加 `compressedText`）；
4. 按 package 写 memo；
5. `story_plan_chapter`：落盘章纲。

## memo 的要求

- `goal`：一句话，具体到本章结束时读者应知道什么、角色应做出什么决定；
- `body`：可读的 Markdown 计划，按场景分段，写清出场人物、冲突、揭示与结尾钩子；
- `threadRefs`：只引用候选与 package 里出现过的伏笔/摘要 id，不虚构；
- 保留作者方向与既成事实；不引入上下文里没有的设定、人物与规则。

## 不要做的事

- 不写正文、不写对白成段；
- 不因为上下文里有某个伏笔就必须回收它；只引用本章真正承接的；
- 不规划当前章之外的章节，也不覆盖已有章纲；
- 不在 memo 里重复大纲原文，用具体场景说话。
