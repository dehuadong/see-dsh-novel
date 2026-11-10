import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { act, create } from 'react-test-renderer'

import { apply, RESUME_TEXT, START_TEXT } from '../src/client/index.ts'
import { outcomeOf } from '../src/client/outcome.ts'
import { presetOf } from '../src/client/preset.ts'
import { StoryView } from '../src/client/StoryView.tsx'

/**
 * 浏览器半边的消费测试。
 *
 * 组件用 react-test-renderer 真实渲染（不装浏览器），注册逻辑用假 ctx 直接
 * 驱动 `apply`；样式安装需要 `document`，所以先补一个最小桩。
 */

const SLOT = 'conversation.view'
const SENTINEL_SLOT = 'conversation.session.header.utilities'
const SESSION = 'session-1'
const packageRoot = fileURLToPath(new URL('..', import.meta.url))

/** 最小 document 桩：样式元素只需要 createElement / head / remove。 */
function installDocumentStub() {
  const head = {
    children: [],
    appendChild(element) { this.children.push(element) },
  }
  globalThis.document = {
    head,
    createElement() {
      return {
        textContent: '',
        remove() {
          const index = head.children.indexOf(this)
          if (index >= 0) head.children.splice(index, 1)
        },
      }
    },
  }
  return head
}

/** 一个会话行 + 投影的假快照。 */
function sessionState(preset, cwd = '/work', running = false) {
  return {
    ids: [SESSION],
    byId: { [SESSION]: { sessionId: SESSION, cwd, running } },
    projectionsBySession: { [SESSION]: { values: preset === undefined ? {} : { agentPreset: preset } } },
  }
}

/** 两个都属于本预设的会话：测面板实例在会话之间复用时的行为。 */
function twoSessionState(other, running = false) {
  return {
    ids: [SESSION, other],
    byId: {
      [SESSION]: { sessionId: SESSION, cwd: '/work', running },
      [other]: { sessionId: other, cwd: '/work', running },
    },
    projectionsBySession: {
      [SESSION]: { values: { agentPreset: 'see-dsh-novel' } },
      [other]: { values: { agentPreset: 'see-dsh-novel' } },
    },
  }
}

/** 渲染时给组件用的 useSessions 选择器钩子。 */
const selectorOf = (state) => (selector) => selector(state)

/** 假 ctx：只实现 apply 用到的面；`files` 模拟宿主 workspaceFiles。 */
function fakeContext(binding, files) {
  const registrations = []
  const injected = new Map()
  const effects = []
  const ctx = {
    slots: {
      register(spec, component) {
        registrations.push({ spec, component })
        return () => {
          const index = registrations.findIndex((entry) => entry.spec === spec)
          if (index >= 0) registrations.splice(index, 1)
        }
      },
      inject(name, callback) {
        injected.set(name, callback)
        return () => { injected.delete(name) }
      },
    },
    sessions: { binding: (id) => (binding === undefined ? undefined : binding(id)) },
    get(name) { return name === 'remote.workspaceFiles' ? files : undefined },
    effect(callback) {
      const dispose = callback()
      effects.push(dispose)
      return () => { dispose?.() }
    },
  }
  return { ctx, registrations, injected, effects }
}

/** 把树里的文本拼起来，用来断言作者看到的话。 */
function textOf(tree) {
  const chunks = []
  const visit = (node) => {
    if (node === null || node === undefined) return
    if (typeof node === 'string' || typeof node === 'number') {
      chunks.push(String(node))
      return
    }
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    visit(node.children)
  }
  visit(tree.toJSON())
  return chunks.join('')
}

/** 按文案取按钮，避免按钮顺序变化把语义测试绑到下标。 */
function buttonByLabel(tree, label) {
  const button = tree.root.findAllByType('button').find((node) => node.children.join('') === label)
  assert.ok(button, `missing button: ${label}`)
  return button
}

/** 渲染一个元素并返回树。 */
async function render(element) {
  let tree
  await act(async () => {
    tree = create(element)
  })
  return tree
}

/** 按槽位名取注册项。 */
const entryFor = (registrations, slot) => registrations.find((entry) => entry.spec.name === slot)

/**
 * 把视图挂到「预设匹配 + 槽位已声明」的状态，返回它的注入面。
 * @param binding 会话绑定工厂；省略表示没有绑定
 */
async function mountEligible(binding, files) {
  const { ctx, registrations, injected } = fakeContext(binding, files)
  apply(ctx)
  const releaseSentinel = injected.get(SENTINEL_SLOT)()
  const releaseSlot = injected.get(SLOT)()
  const sentinel = entryFor(registrations, SENTINEL_SLOT)
  const tree = await render(React.createElement(sentinel.component, {
    sessionId: SESSION,
    useSessions: selectorOf(sessionState('see-dsh-novel')),
    ...sentinel.spec.inject(),
  }))
  return {
    face: entryFor(registrations, SLOT).spec.inject(),
    async dispose() {
      await act(async () => { tree.unmount() })
      releaseSlot()
      releaseSentinel()
    },
  }
}

/** 一份 foundation-ready 的索引；动作与宿主投影的形状一致。 */
function panelIndex(overrides = {}) {
  return {
    version: 4,
    generatedAt: '2026-11-10T00:00:00.000Z',
    revision: 'r1',
    work: { title: '标题', status: 'draft', language: 'zh', currentChapter: 0, nextChapter: 1 },
    stages: [
      { id: 'proposal', label: '提案', status: 'done', summary: '已完成', action: null, secondary: [] },
      {
        id: 'foundation',
        label: '基础设定',
        status: 'current',
        summary: '当前阶段',
        action: { id: 'confirm-foundation', label: '确认基础设定', enabled: true, reason: '' },
        secondary: [
          { id: 'start-chapter', label: '开始下一章', enabled: true, reason: '' },
          { id: 'reject-foundation', label: '退回', enabled: true, reason: '' },
          { id: 'review-foundation', label: '查看待确认', enabled: true, reason: '' },
          { id: 'later', label: '稍后', enabled: true, reason: '' },
        ],
      },
      { id: 'plan', label: '章前规划', status: 'locked', summary: '等待前一阶段', action: null, secondary: [] },
      { id: 'write', label: '正文', status: 'locked', summary: '等待前一阶段', action: null, secondary: [] },
      { id: 'review', label: '审阅', status: 'locked', summary: '等待前一阶段', action: null, secondary: [] },
      { id: 'settle', label: '结算', status: 'locked', summary: '结算/定稿尚未交付', action: null, secondary: [] },
    ],
    artifacts: [],
    action: null,
    confirmation: { kind: 'foundation-signoff', state: 'pending', reason: '等待作者确认' },
    ...overrides,
  }
}

/**
 * 直接渲染 StoryView，绕过条件注册：组件行为单独测。
 * @param options 状态、索引正文与动作钩子
 */
async function renderView({
  state = sessionState('see-dsh-novel'),
  workStatus = 'live',
  foundationStatus = 'live',
  indexStatus = 'live',
  indexVersion = 'v1',
  indexText = JSON.stringify(panelIndex()),
  readArtifact,
  outcome = 'ok',
  runCommand,
  resumeOutcome = 'ok',
  resume,
  startOutcome = 'ok',
  start,
  advance,
  sessionId = SESSION,
} = {}) {
  const foundationSuffixes = ['story_frame.md', 'volume_map.md', 'book_rules.md', 'book_rules.json', 'pending_hooks.md']
  const reads = []
  const calls = []
  const resumes = []
  const starts = []
  const advances = []
  let currentIndexText = indexText
  const resourceStatus = (address) => {
    if (address.endsWith('/panel.index.json')) return indexStatus
    if (address.endsWith('/work.json')) return workStatus
    return foundationSuffixes.some((file) => address.endsWith(`/${file}`)) ? foundationStatus : 'none'
  }
  const base = {
    sessionId,
    useSessions: selectorOf(state),
    useResource: (address) => {
      if (address.endsWith('/panel.index.json')) {
        return {
          status: resourceStatus(address),
          value: indexVersion === undefined ? undefined : { version: indexVersion, absolutePath: '/w/source/story/runtime/panel.index.json' },
          failure: undefined,
        }
      }
      return { status: resourceStatus(address), value: undefined, failure: undefined }
    },
    runCommand: async (id, line) => {
      calls.push({ sessionId: id, line })
      return runCommand === undefined ? outcome : runCommand()
    },
    resume: async (id) => {
      resumes.push(id)
      return resume === undefined ? resumeOutcome : resume()
    },
    start: async (id, cwd) => {
      starts.push({ sessionId: id, cwd })
      return start === undefined ? startOutcome : start()
    },
    advance: async (id, text) => {
      advances.push({ sessionId: id, text })
      return advance === undefined ? 'ok' : advance()
    },
  }
  const props = {
    ...base,
    readArtifact: async (id, path) => {
      reads.push({ sessionId: id, path })
      if (readArtifact !== undefined) return readArtifact({ sessionId: id, path })
      return currentIndexText
    },
  }
  const tree = await render(React.createElement(StoryView, props))
  return {
    tree,
    props,
    calls,
    resumes,
    starts,
    advances,
    reads,
    setIndexText(text) { currentIndexText = text },
  }
}

test('apply installs styles, wires both slots, and registers the view only when eligible', async () => {
  const head = installDocumentStub()
  const { ctx, registrations, injected, effects } = fakeContext()
  apply(ctx)

  assert.equal(head.children.length, 1, '样式元素应挂到 document.head')
  assert.deepEqual([...injected.keys()].sort(), [SLOT, SENTINEL_SLOT].sort())
  assert.equal(entryFor(registrations, SLOT), undefined, '槽位未声明前不应注册')

  // 槽位声明：真实渲染器在槽位出现后才调用 inject 回调。
  const releaseSentinel = injected.get(SENTINEL_SLOT)()
  const releaseSlot = injected.get(SLOT)()
  assert.ok(entryFor(registrations, SENTINEL_SLOT), '哨兵应在槽位声明后注册')
  assert.equal(entryFor(registrations, SLOT), undefined, '还没有预设匹配时不注册视图')

  // 哨兵渲染（预设匹配）→ 上报 eligible → 视图注册。
  const sentinel = entryFor(registrations, SENTINEL_SLOT)
  const sentinelTree = await render(React.createElement(sentinel.component, {
    sessionId: SESSION,
    useSessions: selectorOf(sessionState('see-dsh-novel')),
    ...sentinel.spec.inject(),
  }))
  const view = entryFor(registrations, SLOT)
  assert.ok(view, '预设匹配且槽位已声明时应注册视图')
  assert.equal(view.spec.id, 'see-dsh-novel')
  assert.equal(view.spec.label, '作品')

  // 卸载哨兵 → 上报 false → 视图移除。
  await act(async () => { sentinelTree.unmount() })
  assert.equal(entryFor(registrations, SLOT), undefined)

  // 注销槽位与样式：清理函数把注册与样式都带走。
  releaseSlot()
  releaseSentinel()
  assert.equal(entryFor(registrations, SENTINEL_SLOT), undefined)
  for (const dispose of effects) dispose()
  assert.equal(head.children.length, 0)
})

test('the preset reader tolerates both projection channels', () => {
  assert.equal(presetOf(sessionState('see-dsh-novel'), SESSION), 'see-dsh-novel')
  const legacy = {
    ids: [SESSION],
    byId: { [SESSION]: { sessionId: SESSION, cwd: '/work', projectionValues: { agentPreset: 'legacy' } } },
    projectionsBySession: {},
  }
  assert.equal(presetOf(legacy, SESSION), 'legacy')
  assert.equal(presetOf(sessionState(undefined), SESSION), undefined)
})

test('the index drives the panel: rail, artifacts and the generated timestamp', async () => {
  installDocumentStub()
  const { tree, reads } = await renderView()
  assert.deepEqual(reads, [{ sessionId: SESSION, path: 'source/story/runtime/panel.index.json' }])

  const text = textOf(tree)
  assert.match(text, /索引生成于 2026-11-10T00:00:00.000Z/)
  assert.equal(tree.root.findAllByType('form').length, 0, '面板没有新建表单')
  assert.equal(
    tree.root.findAllByType('button').some((node) => node.children.join('') === '刷新索引'),
    false,
    '面板没有刷新索引按钮',
  )
  // 阶段动作只挂在轨道节点上：每个动作只出现一次。
  for (const label of ['确认基础设定', '开始下一章', '退回', '查看待确认', '稍后']) {
    assert.equal(
      tree.root.findAllByType('button').filter((node) => node.children.join('') === label).length,
      1,
      `${label} 应只出现一次`,
    )
  }
})

test('the panel reloads when the index stat version changes', async () => {
  installDocumentStub()
  const { tree, props, reads } = await renderView()
  assert.equal(reads.length, 1)

  await act(async () => {
    tree.update(React.createElement(StoryView, {
      ...props,
      useResource: (address) => address.endsWith('/panel.index.json')
        ? { status: 'live', value: { version: 'v2', absolutePath: '/w/source/story/runtime/panel.index.json' }, failure: undefined }
        : { status: 'live', value: undefined, failure: undefined },
    }))
  })
  assert.equal(reads.length, 2, '版本变化应重新读取索引正文')
})

test('an index read failure is visible and does not fall back to an old card', async () => {
  installDocumentStub()
  const { tree } = await renderView({
    indexStatus: 'failed',
    readArtifact: () => { throw new Error('workspaceFiles 通道不可用') },
  })
  const text = textOf(tree)
  assert.match(text, /索引读取失败：workspaceFiles 通道不可用/)
  assert.equal(tree.root.findAllByType('form').length, 0)
})

test('no work shows the dialogue guidance instead of a form', async () => {
  installDocumentStub()
  const { tree } = await renderView({
    workStatus: 'failed',
    indexStatus: 'failed',
    readArtifact: () => { throw new Error('not found') },
  })
  const text = textOf(tree)
  assert.match(text, /尚未立项/)
  assert.match(text, /在「对话」里描述作品/)
  assert.doesNotMatch(text, /新建作品/)
  assert.equal(tree.root.findAllByType('button').length, 0)
})

test('a work without an index still offers the foundation start', async () => {
  installDocumentStub()
  const { tree, starts } = await renderView({
    workStatus: 'live',
    foundationStatus: 'failed',
    indexStatus: 'failed',
    readArtifact: () => { throw new Error('not found') },
  })
  assert.match(textOf(tree), /已立项，还没有基础设定/)
  const button = buttonByLabel(tree, '开始基础设定')
  await act(async () => { button.props.onClick() })
  assert.deepEqual(starts, [{ sessionId: SESSION, cwd: '/work' }])
  assert.match(textOf(tree), /已开始基础设定/)
})

test('a complete work without an index says the projection is pending', async () => {
  installDocumentStub()
  const { tree } = await renderView({
    workStatus: 'live',
    foundationStatus: 'live',
    indexStatus: 'failed',
    readArtifact: () => { throw new Error('not found') },
  })
  const text = textOf(tree)
  assert.match(text, /索引还没生成/)
  assert.match(text, /索引读取失败：not found/)
  assert.equal(tree.root.findAllByType('button').length, 0)
})

test('the unreadable channel is reported before guessing about work', async () => {
  installDocumentStub()
  const { tree } = await renderView({
    workStatus: 'none',
    foundationStatus: 'none',
    indexStatus: 'none',
    readArtifact: () => { throw new Error('nope') },
  })
  assert.match(textOf(tree), /读不到工作区状态/)
})

test('approve writes the receipt and resumes the session', async () => {
  installDocumentStub()
  const { tree, calls, resumes } = await renderView()
  await act(async () => { buttonByLabel(tree, '确认基础设定').props.onClick() })
  assert.deepEqual(calls, [{ sessionId: SESSION, line: '/story-approve' }])
  assert.deepEqual(resumes, [SESSION])
  assert.match(textOf(tree), /已确认，正在继续…/)
})

test('a failed resume says the confirmation stands but the session did not continue', async () => {
  installDocumentStub()
  const { tree, resumes } = await renderView({ resumeOutcome: 'failed' })
  await act(async () => { buttonByLabel(tree, '确认基础设定').props.onClick() })
  assert.deepEqual(resumes, [SESSION])
  assert.match(textOf(tree), /已确认；会话没能自动继续/)
})

test('reject and review never wake the session and do not write the index', async () => {
  installDocumentStub()
  const reject = await renderView()
  await act(async () => { buttonByLabel(reject.tree, '退回').props.onClick() })
  assert.deepEqual(reject.calls, [{ sessionId: SESSION, line: '/story-reject' }])
  assert.deepEqual(reject.resumes, [])
  assert.match(textOf(reject.tree), /已退回；这一版不会签核/)

  const review = await renderView()
  await act(async () => { buttonByLabel(review.tree, '查看待确认').props.onClick() })
  assert.deepEqual(review.calls, [{ sessionId: SESSION, line: '/story-review' }])
  assert.deepEqual(review.resumes, [])
})

test('later writes nothing and start-chapter only writes the workflow start', async () => {
  installDocumentStub()
  const later = await renderView()
  await act(async () => { buttonByLabel(later.tree, '稍后').props.onClick() })
  assert.deepEqual(later.calls, [])
  assert.match(textOf(later.tree), /已稍后/)

  const start = await renderView()
  await act(async () => { buttonByLabel(start.tree, '开始下一章').props.onClick() })
  assert.deepEqual(start.calls, [{ sessionId: SESSION, line: '/story-write' }])
  assert.deepEqual(start.resumes, [])
})

test('the stage prompts go through advance instead of tool approvals', async () => {
  installDocumentStub()
  const index = panelIndex({
    stages: [
      { id: 'proposal', label: '提案', status: 'done', summary: '已完成', action: null, secondary: [] },
      { id: 'foundation', label: '基础设定', status: 'done', summary: '已完成', action: null, secondary: [] },
      { id: 'plan', label: '章前规划', status: 'current', summary: '当前阶段', action: { id: 'plan-chapter', label: '规划下一章', enabled: true, reason: '' }, secondary: [] },
      { id: 'write', label: '正文', status: 'locked', summary: '等待前一阶段', action: null, secondary: [] },
      { id: 'review', label: '审阅', status: 'locked', summary: '等待前一阶段', action: null, secondary: [] },
      { id: 'settle', label: '结算', status: 'locked', summary: '结算/定稿尚未交付', action: null, secondary: [] },
    ],
    work: { title: '标题', status: 'draft', language: 'zh', currentChapter: 0, nextChapter: 1 },
  })
  const { tree, advances } = await renderView({ indexText: JSON.stringify(index) })
  await act(async () => { buttonByLabel(tree, '规划下一章').props.onClick() })
  assert.equal(advances.length, 1)
  assert.match(advances[0].text, /规划第 1 章/)
})

test('the root revise action asks the host to run the revision flow', async () => {
  installDocumentStub()
  const revisionIndex = panelIndex({
    stages: panelIndex().stages.map((stage) => (stage.id === 'foundation'
      ? { ...stage, status: 'done', action: null, secondary: [] }
      : stage.id === 'review'
        ? { ...stage, status: 'done' }
        : stage)),
    action: { id: 'revise-chapter', label: '修订本章', enabled: true, reason: '' },
  })
  const { tree, advances } = await renderView({ indexText: JSON.stringify(revisionIndex) })
  await act(async () => { buttonByLabel(tree, '修订本章').props.onClick() })
  assert.equal(advances.length, 1)
  assert.match(advances[0].text, /story_revise_chapter/)
  assert.match(advances[0].text, /重新审稿/)
})

test('a failed command keeps the panel and explains itself', async () => {
  installDocumentStub()
  const failed = await renderView({ outcome: 'error' })
  await act(async () => { buttonByLabel(failed.tree, '确认基础设定').props.onClick() })
  assert.match(textOf(failed.tree), /提交失败，稍后再试/)

  const unmatched = await renderView({ outcome: 'unmatched' })
  await act(async () => { buttonByLabel(unmatched.tree, '查看待确认').props.onClick() })
  assert.match(textOf(unmatched.tree), /这个会话没有该命令/)

  const unbound = await renderView({ outcome: 'unbound' })
  await act(async () => { buttonByLabel(unbound.tree, '退回').props.onClick() })
  assert.match(textOf(unbound.tree), /当前会话还没有就绪/)
})

test('a running session suppresses the actions and says so', async () => {
  installDocumentStub()
  const { tree, calls } = await renderView({ state: sessionState('see-dsh-novel', '/work', true) })
  assert.match(textOf(tree), /会话正在运行/)
  const primary = buttonByLabel(tree, '确认基础设定')
  assert.equal(primary.props.disabled, true)
  for (const label of ['开始下一章', '退回', '查看待确认', '稍后']) {
    assert.equal(buttonByLabel(tree, label).props.disabled, true)
  }
  await act(async () => { primary.props.onClick() })
  assert.deepEqual(calls, [])
})

test('opening an artifact reads its text and reports a read failure', async () => {
  installDocumentStub()
  const index = panelIndex({
    artifacts: [{
      path: 'source/story/outline/story_frame.md', title: 'story_frame.md', type: 'markdown', class: 'truth', stages: ['foundation'],
      modifiedAt: '2026-11-10T00:00:00.000Z', bytes: 1, revision: 'a1', readonly: true,
    }],
  })
  const rowOf = (tree, title) => tree.root.findAllByType('button')
    .find((button) => button.props.className === 'sdn-list-row' && button.children[0].children.join('') === title)

  const ok = await renderView({
    indexText: JSON.stringify(index),
    readArtifact: ({ path }) => (path.endsWith('panel.index.json') ? JSON.stringify(index) : '# 正文'),
  })
  await act(async () => { rowOf(ok.tree, 'story_frame.md').props.onClick() })
  assert.match(textOf(ok.tree), /# 正文/)

  const failing = await renderView({
    indexText: JSON.stringify(index),
    readArtifact: ({ path }) => {
      if (path.endsWith('panel.index.json')) return JSON.stringify(index)
      throw new Error('boom')
    },
  })
  await act(async () => { rowOf(failing.tree, 'story_frame.md').props.onClick() })
  assert.match(textOf(failing.tree), /读不到 source\/story\/outline\/story_frame.md：boom/)
})

test('switching sessions drops the previous index and selection', async () => {
  installDocumentStub()
  const other = 'session-2'
  const { tree, props } = await renderView({ state: twoSessionState(other) })
  const buttons = tree.root.findAllByType('button')
  assert.ok(buttons.some((button) => button.children.join('') === '确认基础设定'))

  await act(async () => {
    tree.update(React.createElement(StoryView, {
      ...props,
      sessionId: other,
      readArtifact: async () => { throw new Error('not found') },
    }))
  })
  assert.doesNotMatch(textOf(tree), /确认基础设定/)
  assert.match(textOf(tree), /索引读取失败：not found/)
})

test('a double click dispatches one command and one resume', async () => {
  installDocumentStub()
  const { tree, calls, resumes } = await renderView()
  const button = buttonByLabel(tree, '确认基础设定')
  await act(async () => {
    button.props.onClick()
    button.props.onClick()
  })
  assert.equal(calls.length, 1)
  assert.equal(resumes.length, 1)
})

test('START_TEXT names the checks the agent must run before writing', () => {
  const text = START_TEXT('/work')
  assert.match(text, /面板看到的工作区是 \/work/)
  assert.match(text, /story_work_show/)
  assert.match(text, /story_next/)
  for (const tool of [
    'story_foundation_outline',
    'story_foundation_details',
    'story_foundation_cast_index',
    'story_foundation_cast_documents',
  ]) {
    assert.match(text, new RegExp(tool))
  }
  assert.match(text, /阶段不是 foundation 就停手/)
  assert.match(text, /不要自行签核/)

  // 拿不到会话目录时不假装比对：明说拿不到，只要求读身份。
  const noPath = START_TEXT(undefined)
  assert.match(noPath, /面板没有拿到这个会话的工作区路径/)
  assert.doesNotMatch(noPath, /是不是这个目录/)
  assert.match(noPath, /story_work_show/)
})

test('the start inject face sends one queue-mode prompt with the cwd', async () => {
  installDocumentStub()
  const prompts = []
  const binding = {
    session: {
      prompt: async (content, mode) => {
        prompts.push({ content, mode })
        return { ok: true, value: { accepted: true } }
      },
    },
  }
  const { face, dispose } = await mountEligible(() => binding)

  assert.equal(await face.start(SESSION, '/work'), 'ok')
  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].mode, 'queue')
  assert.deepEqual(prompts[0].content, [{ type: 'text', text: START_TEXT('/work') }])

  await dispose()
  // 没有会话绑定：确定失败，不调用 prompt。
  const detached = await mountEligible()
  assert.equal(await detached.face.start(SESSION, '/work'), 'failed')
  await detached.dispose()
})

test('command outcomes map to the four visible states', async () => {
  assert.equal(outcomeOf({ ok: true, value: { matched: true } }), 'ok')
  assert.equal(outcomeOf({ ok: true, value: { matched: false } }), 'unmatched')
  assert.equal(outcomeOf({ ok: false }), 'error')
  assert.equal(outcomeOf(undefined), 'error')

  // 没有会话绑定时，注入面直接给出 unbound，不调用命令。
  installDocumentStub()
  const { face, dispose } = await mountEligible()
  assert.equal(await face.runCommand(SESSION, '/story-approve'), 'unbound')
  assert.equal(face.canCommand(SESSION), false)
  await dispose()
})

test('the resume inject face sends one queue-mode continuation prompt', async () => {
  installDocumentStub()
  const prompts = []
  const binding = {
    session: {
      prompt: async (content, mode) => {
        prompts.push({ content, mode })
        return { ok: true, value: { accepted: true } }
      },
    },
  }
  const { face, dispose } = await mountEligible(() => binding)
  assert.deepEqual(await face.resume(SESSION), 'ok')
  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].mode, 'queue')
  assert.deepEqual(prompts[0].content, [{ type: 'text', text: RESUME_TEXT }])
  assert.match(RESUME_TEXT, /story_gate/)
  assert.match(RESUME_TEXT, /story_foundation_signoff/)
  assert.match(RESUME_TEXT, /不要再次请作者确认/)
  assert.doesNotMatch(RESUME_TEXT, /[0-9a-f]{64}/, '消息里不应带摘要')
  await dispose()
})

test('resume reports failure for a rejected prompt or a missing binding', async () => {
  installDocumentStub()
  const failing = { session: { prompt: async () => ({ ok: false }) } }
  const first = await mountEligible(() => failing)
  assert.equal(await first.face.resume(SESSION), 'failed')
  await first.dispose()

  // 没有会话绑定：直接失败，不调用 prompt。
  const second = await mountEligible()
  assert.equal(await second.face.resume(SESSION), 'failed')
  await second.dispose()
})

test('readArtifact reports a missing workspaceFiles namespace instead of throwing raw', async () => {
  installDocumentStub()
  const { face, dispose } = await mountEligible()
  await assert.rejects(face.readArtifact(SESSION, 'work.json'), /workspaceFiles 通道不可用/)
  await dispose()
})

test('readArtifact pages from offset 1 and joins the pages', async () => {
  installDocumentStub()
  const pages = [
    { text: 'a\nb', lines: 2, eof: false },
    { text: 'c', lines: 1, eof: true },
  ]
  const seen = []
  const files = {
    async read(sessionId, path, range) {
      seen.push({ sessionId, path, range })
      return { ok: true, value: pages[seen.length - 1] }
    },
  }
  const { face, dispose } = await mountEligible(undefined, files)
  assert.equal(await face.readArtifact(SESSION, 'panel.index.json'), 'a\nb\nc')
  assert.deepEqual(seen[0], { sessionId: SESSION, path: 'panel.index.json', range: { offset: 1, limit: 5000 } })
  assert.deepEqual(seen[1].range, { offset: 3, limit: 5000 })
  await dispose()
})

test('the built client artifact keeps the module-loader handoff', () => {
  const source = readFileSync(join(packageRoot, 'lib', 'client.js'), 'utf8')
  assert.equal(/require\(["']\.\//.test(source), false, '产物里不应有相对 require')

  // 产物里的函数在 vm 上下文中解析全局，document 要一并给进去。
  const head = installDocumentStub()
  const loaded = []
  const sandbox = {
    window: { __ModuleLoader__: { load: (declaration) => { loaded.push(declaration) } } },
    document: globalThis.document,
  }
  vm.runInNewContext(source, sandbox)
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].id, 'see-dsh-novel')
  assert.equal(typeof loaded[0].factory, 'function')

  const plugin = loaded[0].factory((name) => {
    if (name === 'react') return React
    if (name === 'react/jsx-runtime') return jsxRuntime
    throw new Error(`unexpected client dependency: ${name}`)
  })
  assert.deepEqual([...plugin.inject], ['slots', 'sessions', 'remote'])
  assert.equal(typeof plugin.apply, 'function')

  // 产物的 apply 也要真的能跑：装样式、声明两个槽位。
  const { ctx, injected } = fakeContext()
  plugin.apply(ctx)
  assert.equal(head.children.length, 1)
  assert.deepEqual([...injected.keys()].sort(), [SLOT, SENTINEL_SLOT].sort())
})
