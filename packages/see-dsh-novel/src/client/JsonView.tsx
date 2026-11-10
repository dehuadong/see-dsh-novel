/**
 * 作者产物的 JSON 键值视图。
 *
 * 嵌套对象与数组用可折叠块（浅层默认展开），字符串按真实换行渲染；顶部可切回
 * 原始 JSON。诊断文件不走这里，保持 `<pre>` 原文。
 */
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'

function scalar(value: unknown): string {
  if (value === null) return '—'
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function Node({ name, value, depth }: { name: string; value: unknown; depth: number }): ReactNode {
  if (Array.isArray(value)) {
    return (
      <details className="sdn-json-node" open={depth <= 1}>
        <summary>
          <span className="sdn-json-key">{name}</span>
          <span className="sdn-muted"> [{value.length}]</span>
        </summary>
        {value.map((item, index) => <Node key={index} name={String(index + 1)} value={item} depth={depth + 1} />)}
      </details>
    )
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    return (
      <details className="sdn-json-node" open={depth <= 1}>
        <summary>
          <span className="sdn-json-key">{name}</span>
          <span className="sdn-muted"> {entries.length} 项</span>
        </summary>
        {entries.map(([key, child]) => <Node key={key} name={key} value={child} depth={depth + 1} />)}
      </details>
    )
  }
  return (
    <div className="sdn-json-row">
      <span className="sdn-json-key">{name}</span>
      <span className="sdn-json-value">{scalar(value)}</span>
    </div>
  )
}

/**
 * 渲染一份 JSON：默认键值视图，可切原始文本。
 * @param props 文件正文
 */
export function JsonView({ text }: { text: string }): ReactNode {
  const [raw, setRaw] = useState(false)
  const parsed = useMemo<{ ok: true, value: unknown } | { ok: false }>(() => {
    try {
      return { ok: true, value: JSON.parse(text) as unknown }
    } catch {
      return { ok: false }
    }
  }, [text])
  if (!parsed.ok) return <pre className="sdn-artifact">{text}</pre>

  return (
    <div className="sdn-json">
      <div className="sdn-row">
        <button type="button" className="sdn-secondary" onClick={() => { setRaw(!raw) }}>
          {raw ? '键值视图' : '原始 JSON'}
        </button>
      </div>
      {raw
        ? <pre className="sdn-artifact">{text}</pre>
        : parsed.value !== null && typeof parsed.value === 'object' && !Array.isArray(parsed.value)
          ? Object.entries(parsed.value as Record<string, unknown>)
            .map(([key, value]) => <Node key={key} name={key} value={value} depth={0} />)
          : <Node name="值" value={parsed.value} depth={0} />}
    </div>
  )
}
