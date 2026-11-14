import test from 'node:test'
import assert from 'node:assert/strict'

import React from 'react'
import { act, create } from 'react-test-renderer'

import { Workbench } from '../src/client/Workbench.tsx'

const index = {
  version: 6,
  generatedAt: '2026-11-10T00:00:00.000Z',
  revision: 'r1',
  work: { title: '标题', status: 'draft', language: 'zh', currentChapter: 0, latestChapter: 0, nextChapter: 1 },
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
  artifacts: [
    { path: 'source/story/outline/story_frame.md', title: 'story_frame.md', type: 'markdown', class: 'truth', stages: ['foundation'], modifiedAt: '2026-11-10T00:00:00.000Z', bytes: 1, revision: 'a1', readonly: true },
    { path: 'source/story/book_rules.json', title: 'book_rules.json', type: 'json', class: 'truth', stages: ['foundation'], modifiedAt: '2026-11-10T00:00:00.000Z', bytes: 1, revision: 'a2', readonly: true },
    { path: 'source/chapters/0001_开端.md', title: '第 1 章 · 开端', type: 'markdown', class: 'chapter', stages: ['write', 'review'], modifiedAt: '2026-11-10T00:00:00.000Z', bytes: 1, revision: 'a3', readonly: true },
    { path: 'source/story/runtime/chapter-0001.plan.json', title: '第 1 章 · 章纲', type: 'json', class: 'plan', stages: ['plan'], modifiedAt: '2026-11-10T00:00:00.000Z', bytes: 1, revision: 'a4', readonly: true },
    { path: 'source/story/runtime/chapter-0001.context.json', title: '第 1 章 · 上下文', type: 'json', class: 'diagnostic', stages: ['plan', 'write', 'review'], modifiedAt: '2026-11-10T00:00:00.000Z', bytes: 1, revision: 'a5', readonly: true },
  ],
  action: null,
  confirmation: { kind: 'foundation-signoff', state: 'pending', reason: '等待作者确认' },
}

function render(overrides = {}) {
  const calls = []
  const props = {
    index,
    busy: false,
    running: false,
    notice: '',
    selectedStage: '',
    selectedArtifact: null,
    artifactText: '',
    artifactError: '',
    onSelectStage: (stage) => calls.push(['stage', stage]),
    onOpenArtifact: (artifact) => calls.push(['artifact', artifact.path]),
    onCloseArtifact: () => calls.push(['close']),
    onAction: (action) => calls.push(['action', action.id]),
    ...overrides,
  }
  return { tree: create(React.createElement(Workbench, props)), calls }
}

const rowsOf = (tree) => tree.root.findAllByType('button')
  .filter((button) => button.props.className === 'sdn-list-row')
  .map((button) => button.children[0].children.join(''))

const rowByTitle = (tree, title) => tree.root.findAllByType('button')
  .find((button) => button.props.className === 'sdn-list-row' && button.children[0].children.join('') === title)

const buttonByLabel = (tree, label) => tree.root.findAllByType('button')
  .find((button) => button.children.join('') === label)

const textOf = (tree) => JSON.stringify(tree.toJSON())

test('the action bar carries the current actions once and the stage list navigates', async () => {
  const { tree, calls } = render()
  const buttons = tree.root.findAllByType('button')

  for (const label of ['确认基础设定', '开始下一章', '退回', '查看待确认', '稍后']) {
    assert.equal(buttons.filter((button) => button.children.join('') === label).length, 1, `${label} 应只出现一次`)
  }

  const stageButtons = buttons.filter((button) => button.props.className === 'sdn-stage')
  assert.deepEqual(
    stageButtons.map((button) => `${button.children[0].children.join('')}${button.children[1].children.join('')}`),
    ['✓提案', '●基础设定', '○章前规划', '○正文', '○审阅', '○结算'],
  )
  assert.equal(tree.root.findAllByType('form').length, 0)
  assert.equal(buttons.some((button) => button.children.join('') === '刷新索引'), false)

  await act(async () => {
    buttons.find((button) => button.children.join('') === '确认基础设定').props.onClick()
    buttons.find((button) => button.children.join('') === '退回').props.onClick()
  })
  assert.deepEqual(calls, [['action', 'confirm-foundation'], ['action', 'reject-foundation']])

  calls.length = 0
  await act(async () => { stageButtons[3].props.onClick() })
  assert.deepEqual(calls, [['stage', 'write'], ['close']])
})

test('the artifact list follows the stage and folds the runtime diagnostics', () => {
  assert.deepEqual(rowsOf(render().tree), ['story_frame.md', 'book_rules.json'])
  assert.deepEqual(rowsOf(render({ selectedStage: 'write' }).tree), ['第 1 章 · 开端'])
  assert.deepEqual(rowsOf(render({ selectedStage: 'plan' }).tree), ['第 1 章 · 章纲'])

  // 诊断在折叠分组里，默认不展开。
  const write = render({ selectedStage: 'write' })
  const details = write.tree.root.findAllByType('details').find((node) => node.props.className === 'sdn-diag')
  assert.ok(details)
  assert.equal(details.props.open, undefined)
  assert.equal(details.findAllByType('summary')[0].children.join(''), '运行时诊断（1）')
  assert.ok(details.findAllByType('button').some((button) => button.children[0].children.join('') === '第 1 章 · 上下文'))
})

test('author JSON renders as a key/value view with a raw toggle', async () => {
  const plan = JSON.stringify({ goal: 'g', beats: ['a', 'b'] })
  const { tree } = render({ selectedStage: 'plan', selectedArtifact: index.artifacts[3], artifactText: plan })
  const text = JSON.stringify(tree.toJSON())
  assert.match(text, /"goal"/)
  assert.match(text, /原始 JSON/)

  const toggle = tree.root.findAllByType('button').find((button) => button.children.join('') === '原始 JSON')
  await act(async () => { toggle.props.onClick() })
  assert.match(JSON.stringify(tree.toJSON()), /\\"goal\\":\\"g\\"/)
})

test('a diagnostic opens as raw text with the readonly warning', () => {
  const context = JSON.stringify({ chapter: 1, selectedContext: [] })
  const { tree } = render({
    selectedStage: 'write',
    selectedArtifact: index.artifacts[4],
    artifactText: context,
  })
  const text = JSON.stringify(tree.toJSON())
  assert.match(text, /运行时诊断文件/)
  assert.doesNotMatch(text, /原始 JSON/)
})

test('busy disables the action bar while a submission is in flight', () => {
  const { tree } = render({ busy: true })
  const buttons = tree.root.findAllByType('button')
  const primary = buttons.find((button) => button.children.join('') === '提交中…')
  assert.ok(primary, '主动作应显示提交中')
  assert.equal(primary.props.disabled, true)
  for (const label of ['开始下一章', '退回', '查看待确认', '稍后']) {
    assert.equal(buttons.find((button) => button.children.join('') === label).props.disabled, true)
  }
})

test('the header delete asks for inline confirmation and dispatches once', () => {
  const { tree, calls } = render({ index: { ...index, work: { ...index.work, latestChapter: 1 } } })
  act(() => { buttonByLabel(tree, '删除本章').props.onClick() })
  assert.match(textOf(tree), /只允许删除最新章/)
  act(() => { buttonByLabel(tree, '取消').props.onClick() })
  assert.deepEqual(calls, [])
  assert.equal(tree.root.findAllByType('button').some((button) => button.children.join('') === '删除本章'), true)

  act(() => { buttonByLabel(tree, '删除本章').props.onClick() })
  act(() => { buttonByLabel(tree, '确认删除').props.onClick() })
  assert.deepEqual(calls, [['action', 'delete-chapter']])
})

test('a busy workbench disables the delete confirmation', () => {
  const { tree, calls } = render({ index: { ...index, work: { ...index.work, latestChapter: 1 } }, busy: true })
  act(() => { buttonByLabel(tree, '删除本章').props.onClick() })
  assert.equal(buttonByLabel(tree, '确认删除').props.disabled, true)
  act(() => { buttonByLabel(tree, '确认删除').props.onClick() })
  assert.deepEqual(calls, [])
})

test('a work with no chapter index hides the delete action', () => {
  const { tree } = render()
  assert.equal(tree.root.findAllByType('button').some((button) => button.children.join('') === '删除本章'), false)
})

test('the workbench renders artifact content and the no-work guidance', async () => {
  const selected = render({
    selectedArtifact: index.artifacts[0],
    artifactText: '# 标题',
  })
  assert.match(JSON.stringify(selected.tree.toJSON()), /# 标题/)
  const back = selected.tree.root.findAllByType('button').find((button) => button.children.join('') === '返回阶段')
  await act(async () => { back.props.onClick() })
  assert.deepEqual(selected.calls, [['close']])

  const clicked = render()
  await act(async () => { rowByTitle(clicked.tree, 'story_frame.md').props.onClick() })
  assert.deepEqual(clicked.calls, [['artifact', 'source/story/outline/story_frame.md']])

  const empty = {
    ...index,
    work: null,
    stages: [{ id: 'proposal', label: '提案', status: 'current', summary: '当前阶段', action: null, secondary: [] }],
    artifacts: [],
  }
  const { tree, calls } = render({ index: empty })
  const text = JSON.stringify(tree.toJSON())
  assert.match(text, /在「对话」里描述作品/)
  assert.doesNotMatch(text, /新建作品/)
  assert.equal(tree.root.findAllByType('form').length, 0)
  assert.deepEqual(calls, [])
})

test('a finished chapter shows the root revise action in the action bar', async () => {
  const done = {
    ...index,
    stages: index.stages.map((stage) => (stage.id === 'foundation'
      ? { ...stage, status: 'done', action: null, secondary: [] }
      : stage.id === 'review'
        ? { ...stage, status: 'done' }
        : stage)),
    action: { id: 'revise-chapter', label: '修订本章', enabled: true, reason: '' },
  }
  const { tree, calls } = render({ index: done })
  const buttons = tree.root.findAllByType('button')
  const revise = buttons.find((button) => button.children.join('') === '修订本章')
  assert.ok(revise, '没有当前阶段时应显示根动作')
  await act(async () => { revise.props.onClick() })
  assert.deepEqual(calls, [['action', 'revise-chapter']])
})

test('a finished chapter without a current node says so instead of falling back to proposal', () => {
  const done = {
    ...index,
    stages: index.stages.map((stage) => (stage.id === 'foundation'
      ? { ...stage, status: 'done', action: null, secondary: [] }
      : stage.id === 'review'
        ? { ...stage, status: 'done' }
        : stage)),
    confirmation: { kind: 'chapter', state: 'done', reason: '本章审稿已落盘' },
  }
  const { tree } = render({ index: done })
  const text = JSON.stringify(tree.toJSON())
  assert.match(text, /本章完成/)
  assert.match(text, /本章审稿已落盘/)
})
