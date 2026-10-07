import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  computeZ,
  naiveZ,
  prefixCountsFromZ,
  bordersFromZ,
  occurrencesOfPrefix,
} from '../src/zalgorithm.js';
import { decodeInput, parseEncoding } from '../src/input.js';
import { analyze } from '../src/report.js';
import type { AppConfig } from '../src/config.js';
import { ZService } from '../src/service.js';

const config: AppConfig = {
  dataDir: '',
  dbPath: '',
  maxInputBytes: 1024 * 1024,
  defaultTraceBudget: 2048,
  maxTraceBudget: 100_000,
  maxPageSize: 1000,
  algorithmVersion: 'linear-z/1.0.0',
  port: undefined,
};

test('已知样例 aabcaabxaaaz', () => {
  const bytes = Buffer.from('aabcaabxaaaz', 'utf8');
  const { z } = computeZ(bytes, { traceBudget: 100 });
  assert.deepEqual(z, [0, 1, 0, 0, 3, 1, 0, 0, 2, 2, 1, 0]);
});

test('ababab 真边界与重叠计数', () => {
  const bytes = Buffer.from('ababab', 'utf8');
  const { z } = computeZ(bytes, { traceBudget: 100 });
  assert.deepEqual(bordersFromZ(z), [
    { length: 2, suffixStart: 4 },
    { length: 4, suffixStart: 2 },
  ]);
  const counts = prefixCountsFromZ(z);
  assert.equal(counts[2], 3);
  assert.equal(counts[4], 2);
});

test('aaaa 前缀计数为 4,3,2,1 且位置重叠', () => {
  const bytes = Buffer.from('aaaa', 'utf8');
  const { z } = computeZ(bytes, { traceBudget: 100 });
  const counts = prefixCountsFromZ(z);
  assert.deepEqual([counts[1], counts[2], counts[3], counts[4]], [4, 3, 2, 1]);
  assert.deepEqual(occurrencesOfPrefix(z, 1), [0, 1, 2, 3]);
  assert.deepEqual(occurrencesOfPrefix(z, 2), [0, 1, 2]);
});

const CASES = [
  '',
  'a',
  'ab',
  'aaaa',
  'abcdef',
  '中文边界中文',
  '香蕉苹果香蕉苹果',
  'a'.repeat(50),
  'ab'.repeat(30),
  'mississippi',
];

for (const text of CASES) {
  test(`随机/固定短串对拍: ${JSON.stringify(text.slice(0, 10))}`, () => {
    const bytes = Buffer.from(text, 'utf8');
    const { z } = computeZ(bytes, { traceBudget: 5 });
    assert.equal(z.length, bytes.length, 'Z 数组长度必须等于字节长度');
    assert.deepEqual(z, naiveZ(bytes), '线性算法与朴素逐字节比较不一致');
    const counts = prefixCountsFromZ(z);
    for (let k = 1; k <= bytes.length; k++) {
      const positions = occurrencesOfPrefix(z, k);
      // 总次数与位置清单一致，且每个位置都能切出同样前缀
      assert.equal(positions.length, counts[k], `长度 ${k} 次数不一致`);
      for (const p of positions) {
        assert.ok(p + k <= bytes.length);
        for (let j = 0; j < k; j++) assert.equal(bytes[p + j], bytes[j]);
      }
      // 边界定义核验（真边界排除全串本身 k=n 与空串）
      if (k < bytes.length) {
        const isBorder = positions.includes(bytes.length - k);
        assert.equal(isBorder, z[bytes.length - k] === k);
      }
    }
    assert.deepEqual(bordersFromZ(z), bordersFromZ(naiveZ(bytes)));
  });
}

test('伪随机字节串对拍（含零字节）', () => {
  let seed = 123456789;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % 256;
  };
  for (let trial = 0; trial < 200; trial++) {
    const n = 1 + (rand() % 60);
    const bytes = new Uint8Array(n);
    for (let i = 0; i < n; i++) bytes[i] = trial % 3 === 0 ? rand() % 3 : rand();
    const { z } = computeZ(bytes, { traceBudget: 0 });
    assert.equal(z.length, n);
    assert.equal(z[0], 0);
    assert.deepEqual(z, naiveZ(bytes));
    const counts = prefixCountsFromZ(z);
    for (let k = 1; k <= n; k++) assert.equal(occurrencesOfPrefix(z, k).length, counts[k]);
    for (const b of bordersFromZ(z)) {
      assert.ok(b.length >= 1 && b.length < n);
      assert.equal(z[n - b.length], b.length);
    }
  }
});

test('中文按字节偏移，不混入字符索引', () => {
  const bytes = decodeInput('中中', 'utf8', 1000);
  assert.equal(bytes.length, 6); // E4 B8 AD E4 B8 AD
  const { z } = computeZ(bytes, { traceBudget: 10 });
  assert.deepEqual(z, [0, 0, 0, 3, 0, 0]);
});

test('空输入返回空数组与空统计', () => {
  const r = analyze({ bytes: new Uint8Array(0), encoding: 'utf8', sourceText: '' }, config);
  assert.deepEqual(r.z, []);
  assert.deepEqual(r.prefixCounts, []);
  assert.deepEqual(r.borders, []);
  assert.equal(r.stats.comparisons, 0);
});

test('触及串尾的匹配正常计值，Z[n-1] 可为 1', () => {
  const { z } = computeZ(Buffer.from('aaa', 'utf8'), { traceBudget: 0 });
  assert.deepEqual(z, [0, 2, 1]);
});

test('trace 预算截断时统计仍准确，onlyIndex 定点解释', () => {
  const bytes = Buffer.from('ab'.repeat(100), 'utf8');
  const small = computeZ(bytes, { traceBudget: 5 });
  assert.equal(small.traceTruncated, true);
  assert.equal(small.traces.length, 5);
  assert.deepEqual(small.z, naiveZ(bytes));
  const targeted = computeZ(bytes, { onlyIndex: 100 });
  assert.equal(targeted.traces.length, 1);
  assert.equal(targeted.traces[0]!.i, 100);
});

test('无效十六进制与奇数长度被拒绝', () => {
  const codeOf = (fn: () => unknown) => {
    try {
      fn();
    } catch (err) {
      return (err as { code?: string }).code;
    }
    return undefined;
  };
  assert.equal(codeOf(() => decodeInput('zz', 'hex', 100)), 'INVALID_HEX');
  assert.equal(codeOf(() => decodeInput('abc', 'hex', 100)), 'HEX_ODD_LENGTH');
  assert.equal(codeOf(() => parseEncoding('utf16')), 'UNKNOWN_ENCODING');
  assert.equal(codeOf(() => decodeInput('aa'.repeat(100), 'hex', 10)), 'INPUT_TOO_LARGE');
});

test('SQLite 持久化与跨服务实例读取（模拟跨进程）', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'zinspect-'));
  const cfg: AppConfig = { ...config, dataDir: dir, dbPath: path.join(dir, 'test.db') };
  const id = new ZService(cfg).analyze({ text: 'aabcaabxaaaz' }).id;
  const reopened = new ZService(cfg);
  const r = reopened.get(id);
  assert.deepEqual(r.z, [0, 1, 0, 0, 3, 1, 0, 0, 2, 2, 1, 0]);
  const bytes = reopened.getBytes(id);
  assert.equal(Buffer.from(bytes).toString('utf8'), 'aabcaabxaaaz');
  const positions = reopened.prefixPositions(id, 3, 0, 10);
  assert.deepEqual(positions.positions, [0, 4]);
  assert.equal(reopened.verifyPositions(id, 3).allMatch, true);
});

test('批量分析逐项返回，失败不伪造空数组', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'zinspect-'));
  const cfg: AppConfig = { ...config, dataDir: dir, dbPath: path.join(dir, 'batch.db') };
  const results = new ZService(cfg).batch([{ text: 'aaaa' }, { hex: 'zz' }]);
  assert.equal(results[0]!.ok, true);
  assert.equal(results[1]!.ok, false);
  assert.equal((results[1] as { code: string }).code, 'INVALID_HEX');
});
