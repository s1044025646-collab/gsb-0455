/**
 * 核心线性 Z 算法（按字节、零基偏移）。
 * 输出长度始终等于输入字节长度 n；Z[0] 固定为 0。
 */

export interface ZTraceEntry {
  i: number;
  init: number;
  initSource: 'outside' | 'reuse-clamped-r' | 'reuse-z' | 'zero';
  reusedValue: number;
  compared: Array<{ j: number; k: number; equal: boolean }>;
  z: number;
  lBefore: number;
  rBefore: number;
  updatedBox: boolean;
}

export interface ZResult {
  z: number[];
  comparisons: number;
  reusedInitTotal: number;
  boxUpdates: number;
  traces: ZTraceEntry[];
  traceTruncated: boolean;
  traceOnlyIndex: number | null;
}

export interface ZOptions {
  /** 详细比较记录（traces）最多保留多少个位置；统计结果不受影响。 */
  traceBudget?: number;
  /** 若给出，只保留该下标的详细记录（大规模下定点解释）。 */
  onlyIndex?: number;
}

export function computeZ(bytes: Uint8Array, options: ZOptions = {}): ZResult {
  const n = bytes.length;
  const z = new Array<number>(n).fill(0);
  const traces: ZTraceEntry[] = [];
  const budget = options.traceBudget ?? Infinity;
  const onlyIndex = options.onlyIndex ?? null;

  let comparisons = 0;
  let reusedInitTotal = 0;
  let boxUpdates = 0;
  let traceCount = 0;
  let traceTruncated = false;

  let l = 0;
  let r = 0; // 最右匹配区间为 [l, r)

  for (let i = 1; i < n; i++) {
    const lBefore = l;
    const rBefore = r;
    let init: number;
    let initSource: ZTraceEntry['initSource'];
    let reusedValue = 0;

    if (i < r) {
      const candidate = z[i - l]!;
      const room = r - i;
      if (candidate < room) {
        init = candidate;
        initSource = 'reuse-z';
      } else {
        init = room;
        initSource = 'reuse-clamped-r';
      }
      reusedValue = init;
      reusedInitTotal += init;
    } else {
      init = 0;
      initSource = i === 1 ? 'outside' : 'zero';
    }

    const wantTrace = onlyIndex === null ? traceCount < budget : i === onlyIndex;
    const compared: ZTraceEntry['compared'] = [];

    let k = init;
    // 只比较 [l,r) 初始化区间之外仍可能相等的字节；k+i 不得越过串尾。
    while (i + k < n && bytes[k] === bytes[i + k]) {
      comparisons += 1;
      if (wantTrace) compared.push({ j: i + k, k, equal: true });
      k += 1;
    }
    if (i + k < n) {
      // 显式不相等的比较同样计入比较量（停在此处）。
      comparisons += 1;
      if (wantTrace) compared.push({ j: i + k, k, equal: false });
    }
    z[i] = k;

    let updatedBox = false;
    if (i + k > r) {
      l = i;
      r = i + k; // k 已保证 i+k <= n，右端不会越界
      updatedBox = true;
      boxUpdates += 1;
    }

    if (wantTrace) {
      traces.push({
        i,
        init,
        initSource,
        reusedValue,
        compared,
        z: k,
        lBefore,
        rBefore,
        updatedBox,
      });
      traceCount += 1;
    } else if (onlyIndex === null && traceCount < Number.POSITIVE_INFINITY && traceCount >= budget && !traceTruncated) {
      traceTruncated = true;
    }
  }

  return { z, comparisons, reusedInitTotal, boxUpdates, traces, traceTruncated, traceOnlyIndex: onlyIndex };
}

/** 用 Z 值直方图 + 后缀累加统计每个非空前缀在全文（含重叠）的出现次数。 */
export function prefixCountsFromZ(z: number[]): number[] {
  const n = z.length;
  const counts = new Array<number>(n + 2).fill(0);
  if (n === 0) return [];
  // 起点 0 的一次：覆盖长度 1..n。
  counts[1] = (counts[1] ?? 0) + 1;
  counts[n + 1] = (counts[n + 1] ?? 0) - 1;
  // i>0 处 Z[i]=v 表示长度 1..v 的前缀均在 i 出现（含重叠）。
  // 用 Z 值直方图做差分，再后缀累加；不逐长度重扫，总工作量 O(n)。
  for (let i = 1; i < n; i++) {
    const v = z[i]!;
    if (v >= 1) {
      counts[1] = (counts[1] ?? 0) + 1;
      counts[v + 1] = (counts[v + 1] ?? 0) - 1;
    }
  }
  let acc = 0;
  for (let k = 1; k <= n; k++) {
    acc += counts[k]!;
    counts[k] = acc;
  }
  counts[0] = 0;
  return counts.slice(0, n + 1); // counts[k] = 长度 k 前缀出现次数；空串不计数
}

export interface Border {
  length: number;
  suffixStart: number;
}

/** 非空真边界：1 <= k < n 且 Z[n-k] == k，按长度升序。 */
export function bordersFromZ(z: number[]): Border[] {
  const n = z.length;
  const out: Border[] = [];
  for (let k = 1; k < n; k++) {
    if (z[n - k] === k) out.push({ length: k, suffixStart: n - k });
  }
  return out;
}

/** 长度 k 前缀的全部出现起点（含重叠，含起点 0）。 */
export function occurrencesOfPrefix(z: number[], k: number): number[] {
  const n = z.length;
  const out: number[] = [];
  if (k >= 1 && k <= n) {
    out.push(0);
    for (let i = 1; i + k <= n; i++) {
      if (z[i]! >= k) out.push(i);
    }
  }
  return out;
}

/** 独立朴素实现：仅用于测试交叉核验，不参与正式计算。 */
export function naiveZ(bytes: Uint8Array): number[] {
  const n = bytes.length;
  const z = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    let k = 0;
    while (i + k < n && bytes[k] === bytes[i + k]) k += 1;
    z[i] = k;
  }
  return z;
}
