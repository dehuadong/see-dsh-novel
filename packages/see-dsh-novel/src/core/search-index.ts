/**
 * FTS5 检索内核：文档表 + 全文索引，按 scope 重建、按 BM25 排序。
 */
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'

export interface SearchDocument {
  id: string
  scope: string
  kind: string
  source: string
  title: string
  body: string
}

export interface SearchHit extends SearchDocument {
  score: number
}

/** 中日韩字符逐字加空格：FTS5 的 unicode61 不切 CJK，这里在写入与查询两侧做同一件事。 */
export function segmentCjk(text: string): string {
  return String(text ?? '').replace(/[\u3400-\u9FFF]+/gu, (run) => [...run].join(' '))
}

/** FTS5 查询串：CJK 词转成短语（逐字），拉丁词用前缀通配。 */
export function buildMatchQuery(query: string): string | null {
  const tokens = String(query ?? '')
    .split(/[\s,，。、；;:：!?！？()（）\[\]【】"'“”‘’]+/u)
    .map((token) => token.trim())
    .filter((token) => token !== '')
  if (tokens.length === 0) return null
  return tokens.map((token) => {
    const escaped = token.replaceAll('"', '""')
    return /[\u3400-\u9FFF]/u.test(token) ? `"${[...escaped].join(' ')}"` : `"${escaped}"*`
  }).join(' OR ')
}

function hashDocument(document: SearchDocument): string {
  return createHash('sha256')
    .update(`${document.kind}\u0000${document.source}\u0000${document.title}\u0000${document.body}`)
    .digest('hex')
}

/** 可重建的检索索引；源文件仍是权威。 */
export class LocalSearchIndex {
  private readonly db: DatabaseSync

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS retrieval_documents (
        document_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        kind TEXT NOT NULL,
        source TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        PRIMARY KEY (scope, document_id)
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS retrieval_fts USING fts5(
        document_id, scope UNINDEXED, kind UNINDEXED, source UNINDEXED, title, body
      );
    `)
  }

  close(): void {
    this.db.close()
  }

  replaceScope(scope: string, documents: ReadonlyArray<Omit<SearchDocument, 'scope'>>): void {
    const existing = this.db
      .prepare('SELECT document_id AS id, content_hash AS hash FROM retrieval_documents WHERE scope = ?')
      .all(scope) as Array<{ id: string, hash: string }>
    const hashes = new Map(existing.map((row) => [row.id, row.hash]))
    const keep = new Set(documents.map((document) => document.id))
    const upsert = this.db.prepare(`
      INSERT INTO retrieval_documents (document_id, scope, kind, source, title, body, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope, document_id) DO UPDATE SET
        kind = excluded.kind, source = excluded.source, title = excluded.title,
        body = excluded.body, content_hash = excluded.content_hash
    `)
    const removeDoc = this.db.prepare('DELETE FROM retrieval_documents WHERE scope = ? AND document_id = ?')
    const removeFts = this.db.prepare('DELETE FROM retrieval_fts WHERE scope = ? AND document_id = ?')
    const insertFts = this.db.prepare(
      'INSERT INTO retrieval_fts (document_id, scope, kind, source, title, body) VALUES (?, ?, ?, ?, ?, ?)',
    )

    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const document of documents) {
        const normalized: SearchDocument = { ...document, scope }
        const hash = hashDocument(normalized)
        if (hashes.get(document.id) === hash) continue
        upsert.run(document.id, scope, document.kind, document.source, document.title, document.body, hash)
        removeFts.run(scope, document.id)
        insertFts.run(document.id, scope, document.kind, document.source, segmentCjk(document.title), segmentCjk(document.body))
      }
      for (const row of existing) {
        if (keep.has(row.id)) continue
        removeDoc.run(scope, row.id)
        removeFts.run(scope, row.id)
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  search(query: string, options: { scope: string, kinds?: ReadonlyArray<string>, limit?: number }): SearchHit[] {
    const match = buildMatchQuery(query)
    if (match === null) return []
    const kinds = [...new Set(options.kinds ?? [])]
    const kindFilter = kinds.length > 0 ? ` AND d.kind IN (${kinds.map(() => '?').join(', ')})` : ''
    const limit = Math.max(1, Math.min(200, Math.floor(options.limit ?? 24)))
    const rows = this.db.prepare(`
      SELECT d.document_id AS id, d.scope, d.kind, d.source, d.title, d.body, bm25(retrieval_fts) AS score
      FROM retrieval_fts
      JOIN retrieval_documents d ON d.scope = retrieval_fts.scope AND d.document_id = retrieval_fts.document_id
      WHERE retrieval_fts.scope = ? AND retrieval_fts MATCH ?${kindFilter}
      ORDER BY score ASC, d.source ASC, d.document_id ASC
      LIMIT ?
    `).all(options.scope, match, ...kinds, limit) as unknown as Array<SearchHit & { id: string }>
    return rows.map((row) => ({
      id: row.id,
      scope: row.scope,
      kind: row.kind,
      source: row.source,
      title: row.title,
      body: row.body,
      // bm25 越小越相关；对外用「越大越相关」的分数，保持稳定的小数位。
      score: Number((-row.score).toFixed(4)),
    }))
  }
}
