import { ALGORITHM_VERSION, type AnalysisResult, type AnalyzeOptions, type ZStepRecord } from "./types.js";
import { ApiError } from "../errors.js";

const DEFAULT_TRACE_BUDGET = 4096;

export function analyzeBytes(bytes: Buffer, options: AnalyzeOptions = {}): AnalysisResult {
  const traceBudget = options.traceBudget ?? DEFAULT_TRACE_BUDGET;
  const watchIndex = options.watchIndex;
  if (!Number.isSafeInteger(traceBudget) || traceBudget < 0) {
    throw new ApiError("INVALID_TRACE_BUDGET", "traceBudget 必须是非负安全整数");
  }
  if (watchIndex !== undefined && (!Number.isSafeInteger(watchIndex) || watchIndex < 1 || watchIndex >= bytes.length)) {
    throw new ApiError("INVALID_INDEX", "watchIndex 必须满足 1 <= index < byteLength");
  }

  const n = bytes.length;
  const z = new Array<number>(n).fill(0);
  const histogram = new Array<number>(n + 1).fill(0);
  const trace: ZStepRecord[] = [];
  let l = 0;
  let r = 0;
  let explicitByteComparisons = 0;
  let reusedComparisons = 0;
  let boxReuseEntries = 0;
  let timesRightBoundaryMoved = 0;

  for (let i = 1; i < n; i++) {
    const boxBefore: [number, number] = [l, r];
    let initial = 0;
    let initialization: ZStepRecord["initialization"] = {
      kind: "none",
      reason: "outside-rightmost-box"
    };

    let knownMismatch = false;
    if (i < r) {
      const sourceIndex = i - l;
      const sourceZ = z[sourceIndex] ?? 0;
      const available = r - i;
      initial = Math.min(sourceZ, available);
      knownMismatch = sourceZ < available;
      initialization = {
        kind: "reuse",
        sourceIndex,
        sourceZ,
        available,
        chosen: sourceZ < available ? "source-z" : "remaining-box"
      };
      reusedComparisons += initial;
      boxReuseEntries++;
    }

    let k = initial;
    let comparisons = 0;
    if (!knownMismatch) {
      while (i + k < n && bytes[k] === bytes[i + k]) {
        comparisons++;
        explicitByteComparisons++;
        k++;
      }
    }

    let ending: ZStepRecord["ending"];
    let mismatch: ZStepRecord["mismatch"] | undefined;
    if (knownMismatch) {
      ending = "reused-mismatch";
      mismatch = { prefixOffset: k, suffixOffset: i + k };
    } else if (i + k >= n) {
      ending = "touches-end";
    } else {
      explicitByteComparisons++;
      comparisons++;
      ending = k === initial ? "no-extension" : "mismatch";
      mismatch = { prefixOffset: k, suffixOffset: i + k };
    }

    z[i] = k;
    histogram[k]!++;

    if (k > 0 && i + k > r) {
      l = i;
      r = i + k;
      timesRightBoundaryMoved++;
    }

    const shouldKeep = trace.length < traceBudget || i === watchIndex;
    if (shouldKeep) {
      const record: ZStepRecord = {
        index: i,
        boxBefore,
        initial,
        initialization,
        explicitComparisons: comparisons,
        matchedOutsideInitial: k - initial,
        ending,
        boxAfter: [l, r]
      };
      if (mismatch) record.mismatch = mismatch;
      trace.push(record);
    }

  }

  const suffixFrequency = new Array<number>(n + 1).fill(0);
  for (let length = n - 1; length >= 1; length--) {
    suffixFrequency[length]! = suffixFrequency[length + 1]! + histogram[length]!;
  }

  const prefixCounts = [];
  for (let length = 1; length <= n; length++) {
    prefixCounts.push({ prefixLength: length, occurrences: suffixFrequency[length]! + 1 });
  }

  const borders = [];
  for (let length = 1; length < n; length++) {
    if (z[n - length] === length) {
      borders.push({ length, suffixStart: n - length });
    }
  }

  const eligiblePositions = Math.max(0, n - 1);
  return {
    algorithmVersion: ALGORITHM_VERSION,
    byteLength: n,
    z,
    borders,
    prefixCounts,
    stats: {
      byteLength: n,
      explicitByteComparisons,
      reusedComparisons,
      boxReuseEntries,
      timesRightBoundaryMoved,
      traceRecordsKept: trace.length,
      traceRecordsOmitted: trace.length < eligiblePositions,
      traceRecordBudget: traceBudget
    },
    trace
  };
}

export function prefixOccurrences(z: readonly number[], prefixLength: number, limit: number, offset: number) {
  const n = z.length;
  if (!Number.isSafeInteger(prefixLength) || prefixLength < 1 || prefixLength > n) {
    throw new ApiError("INVALID_PREFIX_LENGTH", "prefixLength 必须满足 1 <= prefixLength <= byteLength");
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
    throw new ApiError("INVALID_LIMIT", "limit 必须是 1 到 1000 的整数");
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new ApiError("INVALID_OFFSET", "offset 必须是非负整数");
  }

  const positions: number[] = [];
  let total = 0;
  let skipped = 0;
  for (let i = 0; i < n; i++) {
    const occurs = i === 0 || (z[i] ?? 0) >= prefixLength;
    if (!occurs) continue;
    total++;
    if (skipped < offset) {
      skipped++;
      continue;
    }
    if (positions.length < limit) positions.push(i);
  }
  return {
    prefixLength,
    total,
    limit,
    offset,
    positions,
    truncated: offset + positions.length < total
  };
}
