import test from 'node:test'
import assert from 'node:assert/strict'

import { installReviewTool, REVIEW_NAME } from '../src/pipelines/long/review-tool.ts'

function tool() {
  const tools = new Map()
  installReviewTool({
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => tools.delete(definition.name) } },
    workingDirectory: { ensure: async () => '/tmp' },
  })
  return tools.get(REVIEW_NAME)
}

test('review observations require object sourceRefs with a sourceId', () => {
  const definition = tool()
  const observation = definition.parameters.properties.observations.items
  assert.deepEqual(observation.required, ['code', 'summary', 'assessment'])
  assert.deepEqual(observation.properties.assessment.enum, ['issue', 'resolved', 'unavailable', 'observation'])
  assert.equal(observation.properties.sourceRefs.items.type, 'object')
  assert.deepEqual(observation.properties.sourceRefs.items.required, ['sourceId'])
  assert.equal(observation.properties.sourceRefs.items.additionalProperties, false)
  assert.deepEqual(
    Object.keys(observation.properties.sourceRefs.items.properties).sort(),
    ['endLine', 'quote', 'sourceId', 'startLine'],
  )
})
