import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Report } from './report.js';

/**
 * 持久层：保存原始字节、编码、摘要、算法版本与完整正式结果。
 * 修改输入会产生新报告（sha256 不同即新行），重启后查询仍针对原字节。
 */
export class ReportStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sha256 TEXT NOT NULL,
        algorithm_version TEXT NOT NULL,
        encoding TEXT NOT NULL,
        source_text TEXT NOT NULL,
        bytes BLOB NOT NULL,
        byte_length INTEGER NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(sha256, algorithm_version)
      );
    `);
  }

  save(partial: Omit<Report, 'id' | 'createdAt'>): Report {
  const insert = this.db.prepare(`
      INSERT INTO reports (sha256, algorithm_version, encoding, source_text, bytes, byte_length, result_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(sha256, algorithm_version) DO UPDATE SET result_json = excluded.result_json
    `);
    const info = insert.run(
      partial.sha256,
      partial.algorithmVersion,
      partial.encoding,
      partial.sourceText,
      Buffer.from(partial.bytesBase64, 'base64'),
      partial.byteLength,
      JSON.stringify(partial),
    );
    const id = Number(info.lastInsertRowid);
    // lastInsertRowid 在冲突更新时为既有行编号之外的值，因此统一按 sha256 回查。
    return this.getByHash(partial.sha256)!;
  }

  get(id: number): Report | undefined {
    const row = this.db
      .prepare('SELECT result_json, created_at FROM reports WHERE id = ?')
      .get(id) as { result_json: string; created_at: string } | undefined;
    if (!row) return undefined;
    return hydrate(row.result_json, id, row.created_at);
  }

  getByHash(sha256: string): Report | undefined {
    const row = this.db
      .prepare('SELECT id, result_json, created_at FROM reports WHERE sha256 = ?')
      .get(sha256) as { id: number | bigint; result_json: string; created_at: string } | undefined;
    if (!row) return undefined;
    return hydrate(row.result_json, Number(row.id), row.created_at);
  }

  bytesOf(id: number): Uint8Array | undefined {
    const row = this.db.prepare('SELECT bytes FROM reports WHERE id = ?').get(id) as
      | { bytes: Uint8Array }
      | undefined;
    return row?.bytes;
  }

  list(limit = 50, offset = 0): Array<{ id: number; sha256: string; byteLength: number; createdAt: string }> {
    const rows = this.db
      .prepare('SELECT id, sha256, byte_length, created_at FROM reports ORDER BY id DESC LIMIT ? OFFSET ?')
      .all(limit, offset) as Array<{ id: number | bigint; sha256: string; byte_length: number; created_at: string }>;
    return rows.map((r) => ({
      id: Number(r.id),
      sha256: r.sha256,
      byteLength: r.byte_length,
      createdAt: r.created_at,
    }));
  }

  close(): void {
    this.db.close();
  }
}

function hydrate(json: string, id: number, createdAt: string): Report {
  const parsed = JSON.parse(json) as Omit<Report, 'id' | 'createdAt'>;
  return { ...parsed, id, createdAt };
}
