import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AnalysisResult } from "../core/types.js";
import type { DecodedInput } from "../core/input.js";

export interface SourceRecord extends DecodedInput {
  id: string;
  createdAt: string;
}

export interface ReportRecord {
  id: string;
  sourceId: string;
  createdAt: string;
  result: AnalysisResult;
}

export class AnalysisRepository {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        bytes BLOB NOT NULL,
        input_encoding TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        preview_text TEXT
      );
      CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        algorithm_version TEXT NOT NULL,
        result_json TEXT NOT NULL,
        FOREIGN KEY(source_id) REFERENCES sources(id)
      );
    `);
  }

  saveSource(input: DecodedInput): SourceRecord {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO sources (id, created_at, bytes, input_encoding, sha256, preview_text) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(id, createdAt, input.bytes, input.inputEncoding, input.sha256, input.previewText ?? null);
    return { id, createdAt, ...input };
  }

  saveReport(sourceId: string, result: AnalysisResult): ReportRecord {
    const source = this.getSourceOrThrow(sourceId);
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const json = JSON.stringify(result);
    this.db
      .prepare(
        `INSERT INTO reports (id, source_id, created_at, algorithm_version, result_json)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(source_id) DO UPDATE SET
           created_at = excluded.created_at,
           algorithm_version = excluded.algorithm_version,
           result_json = excluded.result_json`
      )
      .run(id, sourceId, createdAt, result.algorithmVersion, json);
    return this.getReportBySourceOrThrow(sourceId);
  }

  getSource(id: string): SourceRecord | null {
    const row = this.db
      .prepare(
        "SELECT id, created_at AS createdAt, bytes, input_encoding AS inputEncoding, sha256, preview_text AS previewText FROM sources WHERE id = ?"
      )
      .get(id) as Omit<SourceRecord, "previewText"> & { previewText: string | null } | undefined;
    if (!row) return null;
    const record: SourceRecord = {
      id: row.id,
      createdAt: row.createdAt,
      bytes: Buffer.from(row.bytes as Uint8Array),
      inputEncoding: row.inputEncoding,
      sha256: row.sha256
    };
    if (row.previewText !== null) record.previewText = row.previewText;
    return record;
  }

  getSourceOrThrow(id: string): SourceRecord {
    const source = this.getSource(id);
    if (!source) throw new Error(`SOURCE_NOT_FOUND: ${id}`);
    return source;
  }

  getReportBySource(sourceId: string): ReportRecord | null {
    const row = this.db
      .prepare(
        "SELECT id, source_id AS sourceId, created_at AS createdAt, result_json AS resultJson FROM reports WHERE source_id = ?"
      )
      .get(sourceId) as { id: string; sourceId: string; createdAt: string; resultJson: string } | undefined;
    if (!row) return null;
    return { ...row, result: JSON.parse(row.resultJson) as AnalysisResult };
  }

  getReportBySourceOrThrow(sourceId: string): ReportRecord {
    const report = this.getReportBySource(sourceId);
    if (!report) throw new Error(`REPORT_NOT_FOUND: ${sourceId}`);
    return report;
  }

  getReport(id: string): (ReportRecord & { source: SourceRecord }) | null {
    const row = this.db
      .prepare(
        "SELECT source_id AS sourceId FROM reports WHERE id = ?"
      )
      .get(id) as { sourceId: string } | undefined;
    if (!row) return null;
    const report = this.getReportBySourceOrThrow(row.sourceId);
    return { ...report, source: this.getSourceOrThrow(report.sourceId) };
  }

  close(): void {
    this.db.close();
  }
}
