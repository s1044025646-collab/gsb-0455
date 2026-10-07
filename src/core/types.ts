export const ALGORITHM_VERSION = "z-linear-byte-v1";

export interface ZStepRecord {
  index: number;
  boxBefore: [number, number];
  initial: number;
  initialization:
    | { kind: "none"; reason: "outside-rightmost-box" }
    | {
        kind: "reuse";
        sourceIndex: number;
        sourceZ: number;
        available: number;
        chosen: "source-z" | "remaining-box";
      };
  explicitComparisons: number;
  matchedOutsideInitial: number;
  ending: "mismatch" | "reused-mismatch" | "touches-end" | "no-extension";
  mismatch?: { prefixOffset: number; suffixOffset: number };
  boxAfter: [number, number];
}

export interface ZAlgorithmStats {
  byteLength: number;
  explicitByteComparisons: number;
  reusedComparisons: number;
  boxReuseEntries: number;
  timesRightBoundaryMoved: number;
  traceRecordsKept: number;
  traceRecordsOmitted: boolean;
  traceRecordBudget: number;
}

export interface Border {
  length: number;
  suffixStart: number;
}

export interface PrefixCount {
  prefixLength: number;
  occurrences: number;
}

export interface AnalysisResult {
  algorithmVersion: typeof ALGORITHM_VERSION;
  byteLength: number;
  z: number[];
  borders: Border[];
  prefixCounts: PrefixCount[];
  stats: ZAlgorithmStats;
  trace: ZStepRecord[];
}

export interface AnalyzeOptions {
  traceBudget?: number;
  watchIndex?: number;
}
