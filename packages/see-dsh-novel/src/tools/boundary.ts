/**
 * 源码依赖来源的边界检查（仓库工具，不进包）。
 *
 * 只看依赖说明符指向谁：参考工程（`inkos`／`deepseek-harness`）一律不许，
 * 宿主包（`@deepseek-ai/*`）只许在预设的 agent 半边与浏览器半边 type-only 引用。
 * 分层方向由 `test/boundaries.test.mjs` 管，这里不重复。
 */

/** 问题码。 */
export type BoundaryCode =
  | 'reference-import'
  | 'host-value-import'
  | 'host-import-outside-allowed-layers'
  | 'dynamic-host-import'

/** 一条问题。 */
export interface BoundaryProblem {
  code: BoundaryCode
  /** 相对扫描根的路径，`/` 分隔。 */
  path: string
  /** 出问题的说明符。 */
  detail: string
}

/** 一个待检查的文件。 */
export interface SourceFile {
  path: string
  text: string
}

/** 允许引用宿主类型的层；`client` 与 `plugin` 是预设的前后两半，其余层一律不许。 */
const HOST_ALLOWED_LAYERS = ['client/', 'plugin/']

/** 参考工程的目录名；在仓库根是目录联接。 */
const REFERENCE_NAMES = ['inkos', 'deepseek-harness']

/**
 * 去掉行注释与块注释，保留字符串与模板字面量里的内容。
 * 规则只针对依赖语句，注释里出现目录名不该报。
 */
export function stripComments(text: string): string {
  let out = ''
  let index = 0
  let quote: string | undefined
  while (index < text.length) {
    const char = text[index] as string
    const next = text[index + 1]
    if (quote !== undefined) {
      out += char
      if (char === '\\') {
        out += next ?? ''
        index += 2
        continue
      }
      if (char === quote) quote = undefined
      index += 1
      continue
    }
    if (char === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') index += 1
      continue
    }
    if (char === '/' && next === '*') {
      index += 2
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) index += 1
      index += 2
      continue
    }
    if (char === '"' || char === "'" || char === '`') quote = char
    out += char
    index += 1
  }
  return out
}

/**
 * 说明符是否指向参考工程。
 *
 * 只认契约里列出的形态：裸包名、`inkos/…` 子路径，以及相对路径里出现该段
 * （`../inkos/x`、`./vendor/inkos/x`）。scoped 包（`@scope/inkos`）与别的前缀不算。
 */
export function isReferenceSpecifier(specifier: string): boolean {
  const normalized = specifier.replace(/\\/g, '/')
  const relative = normalized.startsWith('./') || normalized.startsWith('../')
  return REFERENCE_NAMES.some((name) => {
    if (relative) return normalized.split('/').includes(name)
    return normalized === name || normalized.startsWith(`${name}/`)
  })
}

/** 说明符是否指向宿主包。 */
export function isHostSpecifier(specifier: string): boolean {
  return specifier === '@deepseek-ai' || specifier.startsWith('@deepseek-ai/')
}

/** 该文件所在层是否允许引用宿主类型。 */
function hostLayerAllowed(path: string): boolean {
  return HOST_ALLOWED_LAYERS.some((layer) => path.startsWith(layer))
}

/** 一条依赖：说明符、是否 type-only、是不是动态导入。 */
interface Dependency {
  specifier: string
  typeOnly: boolean
  dynamic: boolean
}

/** 说明符 + 上下文 → 问题码；判定顺序在这一处。 */
export function classifyDependency(dependency: Dependency, path: string): BoundaryCode[] {
  const { specifier, typeOnly, dynamic } = dependency
  if (isReferenceSpecifier(specifier)) return ['reference-import']
  if (!isHostSpecifier(specifier)) return []
  if (dynamic) return ['dynamic-host-import']
  const codes: BoundaryCode[] = []
  if (!typeOnly) codes.push('host-value-import')
  if (!hostLayerAllowed(path)) codes.push('host-import-outside-allowed-layers')
  return codes
}

/**
 * 逐行收集静态依赖，只从行首关键字起算。
 *
 * 只有「花括号还没闭合的 import／export 列表」才跨行等待 `from`；这样
 * `export type Id = string`、`export { X }` 不会把下一条语句的 `from` 吞掉，
 * 而多行命名导入仍然能拼起来。
 */
function staticDependencies(text: string): Dependency[] {
  const dependencies: Dependency[] = []
  const lines = text.split(/\r?\n/)
  let pending: { typeOnly: boolean } | undefined

  for (const line of lines) {
    const trimmed = line.trim()
    if (pending !== undefined) {
      // 新语句开始：上一条没有 from，直接放弃等待。
      if (/^(import|export)\b/.test(trimmed)) pending = undefined
      else {
        const from = /\bfrom\s*['"]([^'"]+)['"]/.exec(trimmed)
        if (from?.[1] !== undefined) {
          dependencies.push({ specifier: from[1], typeOnly: pending.typeOnly, dynamic: false })
          pending = undefined
          continue
        }
        if (trimmed.includes('}')) pending = undefined
        continue
      }
    }

    const start = /^(import|export)\b([\s\S]*)$/.exec(trimmed)
    if (start === null) continue
    const keyword = start[1]
    const rest = (start[2] ?? '').trimStart()
    // 动态导入 `import('x')` 由括号扫描处理。
    if (rest.startsWith('(')) continue

    const typeOnly = /^type\b/.test(rest)
    const afterType = typeOnly ? rest.replace(/^type\b/, '').trimStart() : rest
    // export 只有 `export {…}`、`export *`、`export type {…}` 可能带 from。
    if (keyword === 'export' && !/^(\{|\*)/.test(afterType)) continue

    const sideEffect = /^['"]([^'"]+)['"]/.exec(afterType)
    if (sideEffect?.[1] !== undefined) {
      dependencies.push({ specifier: sideEffect[1], typeOnly: false, dynamic: false })
      continue
    }

    const from = /\bfrom\s*['"]([^'"]+)['"]/.exec(afterType)
    if (from?.[1] !== undefined) {
      dependencies.push({ specifier: from[1], typeOnly, dynamic: false })
      continue
    }

    // 只有还没闭合的花括号列表才值得跨行等待 from。
    if (afterType.includes('{') && !afterType.includes('}')) pending = { typeOnly }
  }
  return dependencies
}

/**
 * 检查一批源码文件。
 * @param files 相对路径与文本
 * @returns 问题列表；空数组表示干净
 */
export function boundaryProblems(files: ReadonlyArray<SourceFile>): BoundaryProblem[] {
  const problems: BoundaryProblem[] = []
  for (const file of files) {
    const text = stripComments(file.text)
    const dependencies = staticDependencies(text)
    for (const match of text.matchAll(/\b(require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      if (match[2] === undefined) continue
      dependencies.push({ specifier: match[2], typeOnly: false, dynamic: match[1] === 'import' })
    }
    for (const dependency of dependencies) {
      for (const code of classifyDependency(dependency, file.path)) {
        problems.push({ code, path: file.path, detail: dependency.specifier })
      }
    }
  }
  return problems
}
