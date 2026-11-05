/**
 * 打包产物与 manifest 的对账。
 *
 * 只吃「已经读出来的事实」：条目路径、包内 manifest、已解析的 patch 行、客户端脚本
 * 文本、esbuild 的入口结果、根版本表。读归档与解析 YAML 在脚本层，这里可以纯数据测。
 */

/** 一条问题；`code` 稳定，`detail` 给人读。 */
export interface PackageProblem {
  code: string
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
    dependencies?: Readonly<Record<string, unknown>>
    devDependencies?: Readonly<Record<string, unknown>>
    optionalDependencies?: Readonly<Record<string, unknown>>
    peerDependencies?: Readonly<Record<string, unknown>>
  }
  /** 已解析的 patch 行；解析失败时传 `null`。 */
  patchRows: ReadonlyArray<PatchRow> | null
  /** 包内 `lib/client.js` 的文本。 */
  clientText: string
  /** 每个打包入口的 esbuild 结果。 */
  bundles: ReadonlyArray<EntryBundle>
  /** 根 `devDependencies` 里的 `@deepseek-ai/*` 版本。 */
  rootVersions: Readonly<Record<string, string>>
}

/** 安装期会被 npm 自动执行的脚本；发布包里不该有。 */
export const INSTALL_HOOKS = [
  'preinstall', 'install', 'postinstall', 'prepare',
  'prepublishOnly', 'prepack', 'postpack', 'publish', 'postpublish',
] as const

/** 包里允许出现的文件；新增产物时要同批更新。 */
const ALLOWED_ENTRY = [
  /^package\.json$/,
  /^lib\/(index|agent|client)\.js$/,
  /^skills\/[\w-]+\/SKILL\.md$/,
  /^cordis\.patch\.yml$/,
]

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
function exportTargets(exports: Readonly<Record<string, unknown>> | undefined): string[] {
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

/** 依赖字段里所有 `name -> spec`。 */
function dependencyEntries(manifest: PackageFacts['manifest']): Array<[string, string]> {
  const fields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const
  const pairs: Array<[string, string]> = []
  for (const field of fields) {
    const record = manifest[field]
    if (record === undefined) continue
    for (const [name, spec] of Object.entries(record)) {
      if (typeof spec === 'string') pairs.push([name, spec])
    }
  }
  return pairs
}

/**
 * 对账。
 * @param facts 已读出的事实
 * @returns 问题列表；空数组表示通过
 */
export function packagingProblems(facts: PackageFacts): PackageProblem[] {
  const problems: PackageProblem[] = []
  const push = (code: string, detail: string): void => { problems.push({ code, detail }) }
  const { entries, manifest, packageName } = facts
  const entrySet = new Set(entries)

  for (const entry of manifest.files ?? []) {
    if (!filesEntryPresent(entry, entries)) push('files-entry-missing', entry)
  }

  const targets = exportTargets(manifest.exports)
  for (const target of targets) {
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
    if (!rows.some((row) => row.name === `${packageName}/agent`)) push('patch-row-missing', `${packageName}/agent`)
    for (const row of rows) {
      const name = row.name
      if (typeof name !== 'string' || !name.startsWith(packageName)) continue
      const rest = name.slice(packageName.length).replace(/^\//, '')
      const key = rest === '' ? '.' : `./${rest}`
      if (manifest.exports === undefined || !(key in manifest.exports)) push('patch-module-unexported', name)
    }
  }

  for (const entry of entries) {
    if (!ALLOWED_ENTRY.some((pattern) => pattern.test(entry))) push('unexpected-entry', entry)
  }

  for (const hook of INSTALL_HOOKS) {
    if (manifest.scripts?.[hook] !== undefined) push('install-hook', hook)
  }

  const dependencies = dependencyEntries(manifest)
  for (const [name, spec] of dependencies) {
    if (/^(workspace|file|link):/.test(spec)) push('local-dependency', `${name}: ${spec}`)
    const pinned = facts.rootVersions[name]
    if (pinned !== undefined && spec !== pinned) push('version-drift', `${name}: ${spec} != ${pinned}`)
  }

  const declared = new Set(dependencies.map(([name]) => name))
  for (const bundle of facts.bundles) {
    if (bundle.inputs !== 1) {
      push('bundle-not-self-contained', `${bundle.entry} 打包后有 ${bundle.inputs} 个输入`)
    }
    for (const imported of bundle.imports) {
      if (imported.startsWith('node:')) continue
      if (declared.has(imported)) continue
      push('undeclared-import', `${bundle.entry} -> ${imported}`)
    }
  }

  if (!facts.clientText.includes(`id: "${packageName}"`)) push('client-id-missing', packageName)
  return problems
}
