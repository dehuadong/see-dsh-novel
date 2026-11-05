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
  /** 出问题的说明符或语句。 */
  detail: string
}

/** 一个待检查的文件。 */
export interface SourceFile {
  path: string
  text: string
}

/** 允许引用宿主类型的层；`client` 与 `plugin` 是预设的前后两半。 */
const HOST_ALLOWED_LAYERS = ['client/', 'plugin/']

/** 参考工程的目录名；在仓库根是目录联接。 */
const REFERENCE_SEGMENTS = ['inkos', 'deepseek-harness']

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

/** 说明符是否指向参考工程：整段相等或以它开头，或路径里出现该段。 */
export function isReferenceSpecifier(specifier: string): boolean {
  const normalized = specifier.replace(/\\/g, '/')
  return REFERENCE_SEGMENTS.some((segment) =>
    normalized === segment || normalized.startsWith(`${segment}/`) || normalized.split('/').includes(segment))
}

/** 说明符是否指向宿主包。 */
export function isHostSpecifier(specifier: string): boolean {
  return specifier === '@deepseek-ai' || specifier.startsWith('@deepseek-ai/')
}

/** 该文件所在层是否允许引用宿主类型。 */
function hostLayerAllowed(path: string): boolean {
  return HOST_ALLOWED_LAYERS.some((layer) => path.startsWith(layer))
}

/**
 * 检查一批源码文件。
 * @param files 相对路径与文本
 * @returns 问题列表；空数组表示干净
 */
export function boundaryProblems(files: ReadonlyArray<SourceFile>): BoundaryProblem[] {
  const problems: BoundaryProblem[] = []
  const push = (code: BoundaryCode, path: string, detail: string): void => { problems.push({ code, path, detail }) }

  for (const file of files) {
    const text = stripComments(file.text)

    // 静态 import／export：`import type` 才算 type-only；内联 `{ type X }` 不放行。
    // 只认行首语句，避免把字符串里的 "import … from …" 当成依赖。
    for (const match of text.matchAll(/^[ \t]*(import|export)\s+(type\s+)?[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/gm)) {
      const [, , typeOnly, specifier] = match
      if (specifier === undefined) continue
      const isTypeOnly = typeOnly !== undefined
      if (isReferenceSpecifier(specifier)) {
        push('reference-import', file.path, specifier)
        continue
      }
      if (!isHostSpecifier(specifier)) continue
      if (!isTypeOnly) push('host-value-import', file.path, specifier)
      // 层规则与 type-only 无关：core/pipelines/tools 不该引用宿主类型，哪怕只是类型。
      if (!hostLayerAllowed(file.path)) push('host-import-outside-allowed-layers', file.path, specifier)
    }

    // 副作用导入 `import 'x'`：没有 type 形式，按值依赖算。
    for (const match of text.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) {
      const specifier = match[1]
      if (specifier === undefined) continue
      if (isReferenceSpecifier(specifier)) push('reference-import', file.path, specifier)
      else if (isHostSpecifier(specifier)) push('host-value-import', file.path, specifier)
    }

    // require 与动态 import：宿主包一律按值依赖；动态导入只报 dynamic 一条。
    for (const match of text.matchAll(/\b(require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const [, kind, specifier] = match
      if (specifier === undefined) continue
      if (isReferenceSpecifier(specifier)) {
        push('reference-import', file.path, specifier)
        continue
      }
      if (!isHostSpecifier(specifier)) continue
      push(kind === 'import' ? 'dynamic-host-import' : 'host-value-import', file.path, specifier)
    }
  }
  return problems
}
