import { loadConfig, type AppConfig } from './config.js';
import { ReportStore } from './db.js';
import { analyze, emptyReport, occurrencesOfPrefix, type Report } from './report.js';
import { decodeInput, parseEncoding, sha256Hex } from './input.js';
import { AppError } from './errors.js';

export class ZService {
  readonly config: AppConfig;
  private store: ReportStore;

  constructor(config?: AppConfig) {
    this.config = config ?? loadConfig();
    this.store = new ReportStore(this.config.dbPath);
  }

  analyze(input: { text?: string; hex?: string; encoding?: string; traceBudget?: number; onlyIndex?: number }): Report {
    if (input.hex !== undefined && input.text !== undefined) {
      throw new AppError('BAD_REQUEST', 'text 与 hex 只能提供其一');
    }
    const encoding = parseEncoding(input.hex !== undefined ? 'hex' : input.encoding ?? 'utf8');
    const raw = input.hex !== undefined ? input.hex : (input.text ?? '');
    const bytes = decodeInput(raw, encoding, this.config.maxInputBytes);
    const partial = analyze(
      { bytes, encoding, sourceText: encoding === 'utf8' ? raw : '', traceBudget: input.traceBudget, onlyIndex: input.onlyIndex },
      this.config,
    );
    return this.store.save(partial);
  }

  analyzeEmpty(): Report {
    return this.store.save(emptyReport(this.config));
  }

  batch(items: Array<{ text?: string; hex?: string; encoding?: string }>): Array<
    { ok: true; id: number; sha256: string; byteLength: number } | { ok: false; code: string; message: string; index: number }
  > {
    return items.map((item, index) => {
      try {
        const report = this.analyze(item);
        return { ok: true, id: report.id, sha256: report.sha256, byteLength: report.byteLength };
      } catch (err) {
        if (err instanceof AppError) return { ok: false, code: err.code, message: err.message, index };
        throw err;
      }
    });
  }

  get(id: number): Report {
    const report = this.store.get(id);
    if (!report) throw new AppError('NOT_FOUND', `报告 ${id} 不存在`, 404);
    return report;
  }

  getBytes(id: number): Uint8Array {
    this.get(id);
    const bytes = this.store.bytesOf(id);
    if (!bytes) throw new AppError('NOT_FOUND', `报告 ${id} 的原始字节缺失`, 404);
    return bytes;
  }

  zAt(id: number, index: number): { index: number; z: number; prefixHex: string; windowHex: string } {
    const report = this.get(id);
    if (!Number.isInteger(index) || index < 0 || index >= report.byteLength) {
      throw new AppError('INVALID_INDEX', `下标必须在 [0, ${report.byteLength - 1}] 内`);
    }
    const bytes = this.getBytes(id);
    const z = report.z[index]!;
    return {
      index,
      z,
      prefixHex: Buffer.from(bytes.subarray(0, z)).toString('hex'),
      windowHex: Buffer.from(bytes.subarray(index, index + z)).toString('hex'),
    };
  }

  borders(id: number): Report['borders'] {
    return this.get(id).borders;
  }

  prefixCount(id: number, k: number): { length: number; count: number } {
    const report = this.get(id);
    if (!Number.isInteger(k) || k < 1 || k > report.byteLength) {
      throw new AppError('INVALID_PREFIX_LENGTH', `前缀长度必须在 [1, ${report.byteLength}] 内`);
    }
    return { length: k, count: report.prefixCounts[k]! };
  }

  prefixPositions(
    id: number,
    k: number,
    page = 0,
    pageSize = 100,
  ): { length: number; total: number; page: number; pageSize: number; positions: number[]; truncated: boolean } {
    const report = this.get(id);
    if (!Number.isInteger(k) || k < 1 || k > report.byteLength) {
      throw new AppError('INVALID_PREFIX_LENGTH', `前缀长度必须在 [1, ${report.byteLength}] 内`);
    }
    if (!Number.isInteger(page) || page < 0) throw new AppError('INVALID_PAGINATION', 'page 必须是非负整数');
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > this.config.maxPageSize) {
      throw new AppError('INVALID_PAGINATION', `pageSize 必须在 [1, ${this.config.maxPageSize}] 内`);
    }
    const all = occurrencesOfPrefix(report.z, k);
    const start = page * pageSize;
    return {
      length: k,
      total: all.length,
      page,
      pageSize,
      positions: all.slice(start, start + pageSize),
      truncated: start + pageSize < all.length,
    };
  }

  explain(id: number, index: number, traceBudget?: number): unknown {
    const report = this.get(id);
    const hit = report.trace.entries.find((e) => e.i === index);
    if (hit) return { source: 'stored-trace', index, trace: hit, stats: report.stats };
    // 存储时未保留：对原字节以定点模式重算（不改变已保存的正式结果）。
    const bytes = this.getBytes(id);
    const rerun = analyze(
      { bytes, encoding: report.encoding, sourceText: report.sourceText, onlyIndex: index, traceBudget: traceBudget ?? 1 },
      this.config,
    );
    return { source: 'recomputed-targeted', index, trace: rerun.trace.entries[0] ?? null, stats: rerun.stats };
  }

  verifyPositions(id: number, k: number): { length: number; checked: number; allMatch: boolean; mismatches: number[] } {
    const bytes = this.getBytes(id);
    const positions = occurrencesOfPrefix(this.get(id).z, k);
    const prefix = bytes.subarray(0, k);
    const mismatches: number[] = [];
    for (const p of positions) {
      for (let j = 0; j < k; j++) {
        if (bytes[p + j] !== prefix[j]) {
          mismatches.push(p);
          break;
        }
      }
    }
    return { length: k, checked: positions.length, allMatch: mismatches.length === 0, mismatches };
  }

  list(limit: number, offset: number) {
    return this.store.list(limit, offset);
  }

  close(): void {
    this.store.close();
  }
}

export function generateSample(kind: 'repeat' | 'alternate', length: number, alphabet?: string): { text: string } {
  if (!Number.isInteger(length) || length < 1) {
    throw new AppError('BAD_REQUEST', '样本长度必须是正整数');
  }
  const base = kind === 'repeat' ? alphabet ?? 'a' : alphabet ?? 'ab';
  if (base.length === 0) throw new AppError('BAD_REQUEST', '字母表不能为空');
  let out = '';
  for (let i = 0; i < length; i++) out += base[i % base.length]!;
  return { text: out };
}

export { sha256Hex };
