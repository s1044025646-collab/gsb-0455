import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeBytes, prefixOccurrences } from "../core/zalgorithm.js";
import { naivePrefixPositions, naiveZ } from "../core/naive.js";
import { decodeInput } from "../core/input.js";

describe("线性 Z 算法", () => {
  it("计算指定例子", () => {
    const result = analyzeBytes(Buffer.from("aabcaabxaaaz", "utf8"));
    assert.deepEqual(result.z, [0, 1, 0, 0, 3, 1, 0, 0, 2, 2, 1, 0]);
  });

  it("计算 ababab 真边界和重叠出现次数", () => {
    const result = analyzeBytes(Buffer.from("ababab", "utf8"));
    assert.deepEqual(result.borders, [{ length: 2, suffixStart: 4 }, { length: 4, suffixStart: 2 }]);
    assert.equal(result.prefixCounts[1]?.occurrences, 3);
    assert.equal(result.prefixCounts[3]?.occurrences, 2);
  });

  it("aaaa 的每个长度都按重叠计数", () => {
    const result = analyzeBytes(Buffer.from("aaaa", "utf8"));
    assert.deepEqual(result.z, [0, 3, 2, 1]);
    assert.deepEqual(result.prefixCounts.map((item) => item.occurrences), [4, 3, 2, 1]);
  });

  it("空输入返回空数组和空统计", () => {
    const result = analyzeBytes(Buffer.alloc(0));
    assert.deepEqual(result.z, []);
    assert.deepEqual(result.borders, []);
    assert.deepEqual(result.prefixCounts, []);
    assert.equal(result.stats.explicitByteComparisons, 0);
  });

  it("处理零字节和无重复串", () => {
    const zeros = analyzeBytes(Buffer.from([0, 0, 0, 0]));
    assert.deepEqual(zeros.z, [0, 3, 2, 1]);
    assert.deepEqual(zeros.borders.map((border) => border.length), [1, 2, 3]);

    const distinct = analyzeBytes(Buffer.from([0, 1, 2, 3]));
    assert.deepEqual(distinct.z, [0, 0, 0, 0]);
    assert.deepEqual(distinct.borders, []);
  });

  it("按字节处理中文且不使用 UTF-16 索引", () => {
    const input = decodeInput("中文中文", "utf8");
    assert.equal(input.bytes.length, 12);
    const result = analyzeBytes(input.bytes);
    assert.equal(result.z[6], 6);
    assert.deepEqual(result.borders, [{ length: 6, suffixStart: 6 }]);
  });

  it("短随机字节串与朴素实现一致，并验证所有位置切片", () => {
    for (let seed = 1; seed <= 100; seed++) {
      let state = seed * 9973;
      const next = () => {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        return state % 4;
      };
      const bytes = Buffer.from(Array.from({ length: 1 + (seed % 30) }, () => [0, 97, 98, 228][next()]!));
      const result = analyzeBytes(bytes);
      assert.deepEqual(result.z, naiveZ(bytes), `seed=${seed}`);

      for (const border of result.borders) {
        assert.equal(result.z[border.suffixStart], border.length);
        assert.ok(bytes.subarray(0, border.length).equals(bytes.subarray(border.suffixStart)));
      }

      for (let length = 1; length <= bytes.length; length++) {
        const expected = naivePrefixPositions(bytes, length);
        const count = result.prefixCounts[length - 1]?.occurrences;
        assert.equal(count, expected.length);
        const query = prefixOccurrences(result.z, length, 1000, 0);
        assert.deepEqual(query.positions, expected);
        for (const position of expected) {
          assert.ok(bytes.subarray(position, position + length).equals(bytes.subarray(0, length)));
        }
      }
    }
  });

  it("统计在线过程中的显式比较和复用比较", () => {
    const result = analyzeBytes(Buffer.from("aaaa", "utf8"));
    assert.equal(result.stats.byteLength, 4);
    assert.equal(result.stats.explicitByteComparisons, 3);
    assert.equal(result.stats.reusedComparisons, 3);
    assert.equal(result.trace[0]!.initialization.kind, "none");
    assert.equal(result.trace[1]!.initialization.kind, "reuse");
  });

  it("位置分页不改变总数", () => {
    const result = analyzeBytes(Buffer.from("aaaa", "utf8"));
    assert.deepEqual(prefixOccurrences(result.z, 1, 2, 1).positions, [1, 2]);
    assert.equal(prefixOccurrences(result.z, 1, 2, 1).total, 4);
  });
});
