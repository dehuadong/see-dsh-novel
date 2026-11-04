import test from 'node:test'
import assert from 'node:assert/strict'

import { storyNextOutput, storyNextParameters } from '../src/story-next.js'

/**
 * The runtime accepts a JSON Schema subset, and `tools.register` throws on
 * anything outside it — which fails the whole preset load. Mirror that subset
 * here so a schema regression is caught by `npm test` instead of by a red
 * "加载失败" card in the app.
 *
 * Source of truth: packages/core/tools/src/json-schema.ts in the DSH checkout.
 */
const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])
const KEYWORDS = new Set([
  'type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const',
])
const ANNOTATIONS = new Set(['description', 'title', 'default', 'examples'])
/** Constraint keywords that may not sit beside `oneOf`. */
const ONE_OF_SIBLINGS = ['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const']

function violations(node, path = 'schema', out = []) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    out.push(`${path} must be a schema object`)
    return out
  }
  for (const key of Object.keys(node)) {
    if (KEYWORDS.has(key) || ANNOTATIONS.has(key)) continue
    out.push(`${path}.${key} is not a supported keyword`)
  }
  const hasType = Object.hasOwn(node, 'type')
  const hasOneOf = Object.hasOwn(node, 'oneOf')
  if (hasType && hasOneOf) {
    out.push(`${path} cannot declare both type and oneOf`)
    return out
  }
  if (hasOneOf) {
    for (const key of ONE_OF_SIBLINGS) {
      if (Object.hasOwn(node, key)) out.push(`${path}.${key} is not supported beside oneOf`)
    }
    if (!Array.isArray(node.oneOf) || node.oneOf.length < 2) {
      out.push(`${path}.oneOf must be an array of at least two schemas`)
    } else {
      node.oneOf.forEach((child, index) => violations(child, `${path}.oneOf[${index}]`, out))
    }
    return out
  }
  if (!hasType) {
    out.push(`${path} must declare type or oneOf`)
    return out
  }
  if (typeof node.type !== 'string' || !TYPES.has(node.type)) {
    out.push(Array.isArray(node.type)
      ? `${path}.type must be a single type string (type arrays are not supported)`
      : `${path}.type must be one of ${[...TYPES].join('/')}`)
    return out
  }
  for (const key of ['enum', 'const']) {
    if (!Object.hasOwn(node, key)) continue
    if (node.type === 'object' || node.type === 'array') {
      out.push(`${path}.${key} is not supported on type "${node.type}"`)
    }
  }
  if (node.type === 'object') {
    if (Object.hasOwn(node, 'properties')) {
      if (node.properties === null || typeof node.properties !== 'object' || Array.isArray(node.properties)) {
        out.push(`${path}.properties must be an object of schemas`)
      } else {
        for (const [key, child] of Object.entries(node.properties)) {
          violations(child, `${path}.properties.${key}`, out)
        }
      }
    }
    if (Object.hasOwn(node, 'required')) {
      if (!Array.isArray(node.required) || node.required.some((entry) => typeof entry !== 'string')) {
        out.push(`${path}.required must be an array of strings`)
      } else {
        const declared = node.properties ?? {}
        for (const key of node.required) {
          if (!Object.hasOwn(declared, key)) out.push(`${path}.required names "${key}" which is not in properties`)
        }
      }
    }
    if (Object.hasOwn(node, 'additionalProperties') && typeof node.additionalProperties !== 'boolean') {
      out.push(`${path}.additionalProperties must be a boolean`)
    }
  } else if (node.type === 'array' && Object.hasOwn(node, 'items')) {
    violations(node.items, `${path}.items`, out)
  }
  return out
}

test('story_next parameters stay inside the runtime schema subset', () => {
  assert.deepEqual(violations(storyNextParameters), [])
})

test('story_next output stays inside the runtime schema subset', () => {
  assert.deepEqual(violations(storyNextOutput), [])
})

test('the subset mirror rejects type arrays', () => {
  assert.match(
    violations({ type: 'object', properties: { work: { type: ['string', 'null'] } } }).join('\n'),
    /type arrays are not supported/,
  )
})
