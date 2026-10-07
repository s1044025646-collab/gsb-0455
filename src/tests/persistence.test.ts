import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { AnalysisRepository } from "../db/repository.js";
import { decodeInput } from "../core/input.js";

describe("SQLite 持久化", () => {
  const dirPromise = mkdtemp(join(tmpdir(), "zbyte-"));

  after(async () => {
    await rm(await dirPromise, { recursive: true, force: true });
  });

  it("重新打开仓库后仍查询原始字节和正式报告", async () => {
    const dir = await dirPromise;
    const dbPath = join(dir, "test.sqlite");
    let repository = new AnalysisRepository(dbPath);
    const source = repository.saveSource(decodeInput("ababab", "utf8"));
    const { analyzeBytes } = await import("../core/zalgorithm.js");
    repository.saveReport(source.id, analyzeBytes(source.bytes));
    repository.close();

    repository = new AnalysisRepository(dbPath);
    const loaded = repository.getReportBySource(source.id);
    assert.ok(loaded);
    assert.deepEqual(loaded.result.borders, [{ length: 2, suffixStart: 4 }, { length: 4, suffixStart: 2 }]);
    assert.equal(repository.getSource(source.id)?.bytes.toString("utf8"), "ababab");
    repository.close();
  });

  it("拒绝无效十六进制和奇数长度", () => {
    assert.throws(() => decodeInput("abc", "hex"), (error: unknown) => error instanceof Error && error.name === "ApiError" && (error as { code?: string }).code === "INVALID_HEX");
    assert.throws(() => decodeInput("zz", "hex"), (error: unknown) => error instanceof Error && error.name === "ApiError" && (error as { code?: string }).code === "INVALID_HEX");
  });
});
