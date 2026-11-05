/**
 * 打包产物与 manifest 的对账（仓库工具，不进包）。
 *
 * 只吃「已经读出来的事实」：条目路径、包内 manifest、已解析的 patch 行、preset 的
 * 插件名、客户端脚本、esbuild 入口结果。读归档与解析 YAML 在脚本层，这里可纯数据测。
 */

/** 问题码；与 note 的表格一一对应。 */
export type PackageProblemCode =
  | 'files-entry-missing'
  | 'export-target-missing'
  | 'pack-patch-missing'
  | 'patch-module-unexported'
  | 'patch-row-missing'
  | 'patch-invalid'
  | 'unexpected-entry'
  | 'install-hook'
  | 'undeclared-import'
  | 'bundle-not-self-contained'
  | 'client-id-missing'

/** 一条问题。 */
export interface PackageProblem {
  code: PackageProblemCode
  detail: string
}

/** patch 里的一行：只关心 id 与模块名。 */
export interface PatchRow {
  id?: string
  name?: string
}

/** 打包入口的 esbuild 结果。 */
export interface EntryBundle {
  entry: string
  imports: ReadonlyArray<string>
  inputs: number
}

/** 对账所需的事实。 */
export interface PackageFacts {
  /** 包名；客户端 id 与 patch 行都以它为前缀。 */
  packageName: string
  /** tarball 条目，`package/` 之后的相对路径。 */
  entries: ReadonlyArray<string>
  manifest: {
    files?: ReadonlyArray<string>
    exports?: Readonly<Record<string, unknown>>
    dsh?: { bundle?: { patch?: unknown } }
    scripts?: Readonly<Record<string, unknown>>
  }
  /** 已解析的 patch 行；解析失败时传 `null`。 */
  patchRows: ReadonlyArray<PatchRow> | null
  /** preset 行 `config.plugins` 里的模块名。 */
  presetPlugins: ReadonlyArray<string>
  /** 包内 `lib/client.js` 的文本。 */
  clientText: string
  /** 每个打包入口的 esbuild 结果。 */
  bundles: ReadonlyArray<EntryBundle>
}

/** 安装期会被 npm 自动执行的脚本；发布包里不该有。 */
export const INSTALL_HOOKS = [
  'preinstall', 'install', 'postinstall', 'prepare',
  'prepublishOnly', 'prepack', 'postpack', 'publish', 'postpublish',
] as const

/** 去掉 `./` 与首尾斜杠，统一再比。 */
function normalize(path: string): string {
  return path.replace(/^\.\//, '').replace(/^\/+|\/+$/g, '')
}

/** `files` 的某一项在条目里有没有对应（目录按前缀、文件按全等）。 */
function filesEntryPresent(entry: string, entries: ReadonlyArray<string>): boolean {
  const target = normalize(entry)
  return entries.some((path) => path === target || path.startsWith(`${target}/`))
}

/** `exports` 的字符串目标（去掉 `./`）。 */
export function exportTargets(exports: Readonly<Record<string, unknown>> | undefined): string[] {
  if (exports === undefined) return []
  const targets: string[] = []
  for (const value of Object.values(exports)) {
    if (typeof value === 'string') targets.push(normalize(value))
    else if (value !== null && typeof value === 'object') {
      for (const nested of Object.values(value as Record<string, unknown>)) {
        if (typeof nested === 'string') targets.push(normalize(nested))
      }
    }
  }
  return [...new Set(targets)]
}

/** 允许出现的条目：清单声明的入口、patch 与包清单，加上契约里的技能文档。 */
function allowedEntries(facts: PackageFacts): ReadonlyArray<RegExp> {
  const patchPath = typeof facts.manifest.dsh?.bundle?.patch === 'string' ? normalize(facts.manifest.dsh.bundle.patch) : undefined
  const declared = [...exportTargets(facts.manifest.exports), ...(patchPath === undefined ? [] : [patchPath])]
  return [
    /^package\.json$/,
    /^skills\/[\w-]+\/SKILL\.md$/,
    ...declared.map((target) => new RegExp(`^${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)),
  ]
}

/**
 * 对账。
 * @param facts 已读出的事实
 * @returns 问题列表；空数组表示通过
 */
export function packagingProblems(facts: PackageFacts): PackageProblem[] {
  const problems: PackageProblem[] = []
  const push = (code: PackageProblemCode, detail: string): void => { problems.push({ code, detail }) }
  const { entries, manifest, packageName } = facts
  const entrySet = new Set(entries)

  for (const entry of manifest.files ?? []) {
    if (!filesEntryPresent(entry, entries)) push('files-entry-missing', entry)
  }

  for (const target of exportTargets(manifest.exports)) {
    if (!entrySet.has(target)) push('export-target-missing', target)
  }

  const patchPath = typeof manifest.dsh?.bundle?.patch === 'string' ? normalize(manifest.dsh.bundle.patch) : undefined
  if (patchPath !== undefined && !entrySet.has(patchPath)) push('pack-patch-missing', patchPath)

  if (facts.patchRows === null) {
    push('patch-invalid', 'cordis.patch.yml 解析不出任何行')
  } else {
    const rows = facts.patchRows
    if (!rows.some((row) => row.id === packageName)) push('patch-row-missing', packageName)
    if (!rows.some((row) => row.id === `preset-${packageName}` && row.name === '@deepseek-ai/dsh-agent-preset')) {
      push('patch-row-missing', `preset-${packageName}`)
    }
    if (!facts.presetPlugins.includes(`${packageName}/agent`)) push('patch-row-missing', `${packageName}/agent`)
    for (const row of rows) {
      const name = row.name
      if (typeof name !== 'string') continue
      if (name !== packageName && !name.startsWith(`${packageName}/`)) continue
      const rest = name === packageName ? '' : name.slice(packageName.length + 1)
      const key = rest === '' ? '.' : `./${rest}`
      if (manifest.exports === undefined || !(key in manifest.exports)) push('patch-module-unexported', name)
    }
  }

  const allowed = allowedEntries(facts)
  for (const entry of entries) {
    if (!allowed.some((pattern) => pattern.test(entry))) push('unexpected-entry', entry)
  }

  for (const hook of INSTALL_HOOKS) {
    if (manifest.scripts?.[hook] !== undefined) push('install-hook', hook)
  }

  for (const bundle of facts.bundles) {
    if (bundle.inputs !== 1) push('bundle-not-self-contained', `${bundle.entry} 打包后有 ${bundle.inputs} 个输入`)
    for (const imported of bundle.imports) {
      if (imported.startsWith('node:')) continue
      push('undeclared-import', `${bundle.entry} -> ${imported}`)
    }
  }

  if (!facts.clientText.includes(`id: "${packageName}"`)) push('client-id-missing', packageName)
  return problems
}
