import { createHash } from 'node:crypto';
import { AppError } from './errors.js';
import type { AppConfig } from './config.js';
import {
  computeZ,
  prefixCountsFromZ,
  bordersFromZ,
  occurrencesOfPrefix,
  type ZTraceEntry,
} from './zalgorithm.js';

export interface Report {
  id: number;
  algorithmVersion: string;
  encoding: string;
  sourceText: string;
  bytesBase64: string;
  byteLength: number;
  sha256: string;
  createdAt: string;
  z: number[];
  borders: Array<{ length: number; suffixStart: number }>;
  prefixCounts: number[];
  stats: {
    comparisons: number;
    reusedInitTotal: number;
    boxUpdates: number;
    computeMs: number;
  };
  trace: {
    retained: number;
    budget: number;
    truncated: boolean;
    onlyIndex: number | null;
    entries: ZTraceEntry[];
  };
}

export interface AnalyzeParams {
  bytes: Uint8Array;
  encoding: string;
  sourceText: string;
  traceBudget?: number;
  onlyIndex?: number;
}

export function analyze(params: AnalyzeParams, config: AppConfig): Omit<Report, 'id' | 'createdAt'> {
  const budget = params.traceBudget ?? config.defaultTraceBudget;
  if (!Number.isInteger(budget) || budget < 0) {
    throw new AppError('INVALID_LIMIT', 'traceBudget 必须是非负整数');
  }
  if (budget > config.maxTraceBudget) {
    throw new AppError('INVALID_LIMIT', `traceBudget 超过允许上限 ${config.maxTraceBudget}`);
  }
  if (
    params.onlyIndex !== undefined &&
    (!Number.isInteger(params.onlyIndex) || params.onlyIndex < 0 || params.onlyIndex >= params.bytes.length)
  ) {
    throw new AppError('INVALID_INDEX', `onlyIndex 必须在 [0, ${params.bytes.length - 1}] 内`);
  }

  // 性能统计只覆盖核心计算，不包含数据库写入。
  const start = performance.now();
  const zr = computeZ(params.bytes, {
    traceBudget: budget,
    onlyIndex: params.onlyIndex,
  });
  const prefixCounts = prefixCountsFromZ(zr.z);
  const borders = bordersFromZ(zr.z);
  const computeMs = performance.now() - start;

  return {
    algorithmVersion: config.algorithmVersion,
    encoding: params.encoding,
    sourceText: params.sourceText,
    bytesBase64: Buffer.from(params.bytes).toString('base64'),
    byteLength: params.bytes.length,
    sha256: sha256FromBytes(params.bytes),
    z: zr.z,
    borders,
    prefixCounts,
    stats: {
      comparisons: zr.comparisons,
      reusedInitTotal: zr.reusedInitTotal,
      boxUpdates: zr.boxUpdates,
      computeMs: Number(computeMs.toFixed(4)),
    },
    trace: {
      retained: zr.traces.length,
      budget,
      truncated: zr.traceTruncated,
      onlyIndex: zr.traceOnlyIndex,
      entries: zr.traces,
    },
  };
}

export function emptyReport(config: AppConfig): Omit<Report, 'id' | 'createdAt'> {
  return {
    algorithmVersion: config.algorithmVersion,
    encoding: 'utf8',
    sourceText: '',
    bytesBase64: '',
    byteLength: 0,
    sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    z: [],
    borders: [],
    prefixCounts: [],
    stats: { comparisons: 0, reusedInitTotal: 0, boxUpdates: 0, computeMs: 0 },
    trace: { retained: 0, budget: 0, truncated: false, onlyIndex: null, entries: [] },
  };
}

function sha256FromBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export { occurrencesOfPrefix };
