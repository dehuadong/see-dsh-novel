import test from 'node:test'
import assert from 'node:assert/strict'

import React from 'react'
import { act, create } from 'react-test-renderer'

import { Workbench } from '../src/client/Workbench.tsx'

const index = {
  version: 1,
  generatedAt: '2026-11-09T00:00:00.000Z',
  revision: 'r1',
  work: { title: '标题', status: 'draft', language: 'zh', currentChapter: 0, nextChapter: 1 },
  stages: [
    { id: 'proposal', label: '提案', status: 'done', summary: '已完成', action: null },
    { id: 'foundation', label: '基础设定', status: 'current', summary: '当前阶段', action: { id: 'confirm-foundation', label: '确认基础设定', enabled: true, reason: '' } },
    { id: 'plan', label: '章前规划', status: 'locked', summary: '等待前一阶段', action: null },
    { id: 'write', label: '正文', status: 'locked', summary: '等待前一阶段', action: null },
    { id: 'review', label: '审阅', status: 'locked', summary: '等待前一阶段', action: null },
    { id: 'settle', label: '结算', status: 'locked', summary: '结算/定稿尚未交付', action: null },
  ],
  artifacts: [
    { path: 'source/story/outline/story_frame.md', title: 'story_frame.md', type: 'markdown', group: 'foundation', modifiedAt: '2026-11-09T00:00:00.000Z', bytes: 1, revision: 'a1', readonly: true },
  ],
  confirmation: { kind: 'foundation-signoff', state: 'pending', reason: '等待作者确认' },
}

function render(overrides = {}) {
  const calls = []
  const props = {
    index,
    busy: false,
    notice: '',
    selectedStage: '',
    selectedArtifact: null,
    artifactText: '',
    artifactError: '',
    onSelectStage: (stage) => calls.push(['stage', stage]),
    onOpenArtifact: (artifact) => calls.push(['artifact', artifact.path]),
    onCloseArtifact: () => calls.push(['close']),
    onAction: (action) => calls.push(['action', action.id]),
    onRefresh: () => calls.push(['refresh']),
    onNewWork: (input) => calls.push(['new', input.title]),
    ...overrides,
  }
  return { tree: create(React.createElement(Workbench, props)), calls }
}

test('the workbench shows the rail, navigation and artifact list without scattering actions', async () => {
  const { tree, calls } = render()
  const buttons = tree.root.findAllByType('button')
  assert.ok(buttons.some((button) => button.children.join('') === '确认基础设定'))
  assert.ok(buttons.some((button) => button.children.join('') === 'story_frame.md'))
  assert.equal(buttons.filter((button) => button.children.join('') === '确认基础设定').length, 1)
  await act(async () => {
    buttons.find((button) => button.children.join('') === '确认基础设定').props.onClick()
    buttons.find((button) => button.children.join('') === 'story_frame.md').props.onClick()
  })
  assert.deepEqual(calls, [['action', 'confirm-foundation'], ['artifact', 'source/story/outline/story_frame.md']])
})

test('the workbench renders artifact content and a no-work new form', async () => {
  const selected = render({
    selectedArtifact: index.artifacts[0],
    artifactText: '# 标题',
  })
  assert.match(JSON.stringify(selected.tree.toJSON()), /# 标题/)

  const empty = {
    ...index,
    work: null,
    stages: [{ id: 'proposal', label: '提案', status: 'current', summary: '当前阶段', action: { id: 'new-work', label: '新建作品', enabled: true, reason: '' } }],
    artifacts: [],
  }
  const { tree, calls } = render({ index: empty })
  const newButton = tree.root.findAllByType('button').find((button) => button.children.join('') === '新建作品')
  await act(async () => { newButton.props.onClick() })
  const form = tree.root.findByType('form')
  assert.ok(form)
  await act(async () => {
    tree.root.findAllByType('input')[0].props.onChange({ target: { value: '新书' } })
  })
  await act(async () => {
    tree.root.findByType('form').props.onSubmit({ preventDefault() {} })
  })
  assert.deepEqual(calls.filter((call) => call[0] === 'new')[0], ['new', '新书'])
})
