import { resolve } from "node:path";
import { analyzeBytes, prefixOccurrences } from "./core/zalgorithm.js";
import { decodeInput, decodeFile, type DecodedInput, type InputEncoding } from "./core/input.js";
import { AnalysisRepository, type ReportRecord, type SourceRecord } from "./db/repository.js";
import { ApiError } from "./errors.js";
import { DEFAULT_TRACE_BUDGET } from "./core/budget.js";

export interface AnalyzeInputRequest {
  text: string;
  encoding?: InputEncoding | undefined;
  maxBytes?: number | undefined;
  traceBudget?: number | undefined;
}

export class AnalysisService {
  constructor(private readonly repository: AnalysisRepository) {}

  importSource(request: AnalyzeInputRequest): SourceRecord {
    return this.repository.saveSource(this.decodeRequest(request));
  }

  analyze(request: AnalyzeInputRequest): ReportRecord {
    const source = this.repository.saveSource(this.decodeRequest(request));
    const result = analyzeBytes(source.bytes, { traceBudget: request.traceBudget ?? DEFAULT_TRACE_BUDGET });
    return this.repository.saveReport(source.id, result);
  }

  async importFile(path: string, encoding: InputEncoding, maxBytes?: number) {
    return this.repository.saveSource(await decodeFile(path, encoding, maxBytes));
  }

  analyzeSource(sourceId: string, traceBudget = DEFAULT_TRACE_BUDGET): ReportRecord {
    const source = this.repository.getSource(sourceId);
    if (!source) throw new ApiError("SOURCE_NOT_FOUND", "源字节不存在", 404);
    return this.repository.saveReport(source.id, analyzeBytes(source.bytes, { traceBudget }));
  }

  async analyzeFile(path: string, encoding: InputEncoding, maxBytes?: number, traceBudget = DEFAULT_TRACE_BUDGET): Promise<ReportRecord> {
    const source = this.repository.saveSource(await decodeFile(path, encoding, maxBytes));
    return this.repository.saveReport(source.id, analyzeBytes(source.bytes, { traceBudget }));
  }

  getReport(sourceId: string): ReportRecord {
    const report = this.repository.getReportBySource(sourceId);
    if (!report) throw new ApiError("REPORT_NOT_FOUND", "该源字节尚无分析报告", 404);
    return report;
  }

  getSource(sourceId: string): SourceRecord {
    const source = this.repository.getSource(sourceId);
    if (!source) throw new ApiError("SOURCE_NOT_FOUND", "源字节不存在", 404);
    return source;
  }

  queryIndex(sourceId: string, index: number) {
    const source = this.getSource(sourceId);
    const report = this.getReport(sourceId);
    if (!Number.isSafeInteger(index) || index < 0 || index >= source.bytes.length) {
      throw new ApiError("INVALID_INDEX", "index 必须满足 0 <= index < byteLength");
    }
    return {
      index,
      byte: source.bytes[index],
      z: report.result.z[index],
      prefixBytes: source.bytes.subarray(0, report.result.z[index]).toString("hex")
    };
  }

  getBorders(sourceId: string) {
    return this.getReport(sourceId).result.borders;
  }

  getPrefixCount(sourceId: string, prefixLength: number) {
    const report = this.getReport(sourceId);
    const entry = report.result.prefixCounts[prefixLength - 1];
    if (!entry) throw new ApiError("INVALID_PREFIX_LENGTH", "prefixLength 必须满足 1 <= prefixLength <= byteLength");
    return entry;
  }

  getPrefixPositions(sourceId: string, prefixLength: number, limit: number, offset: number) {
    return prefixOccurrences(this.getReport(sourceId).result.z, prefixLength, limit, offset);
  }

  explain(sourceId: string, index: number, traceBudget = DEFAULT_TRACE_BUDGET) {
    const source = this.getSource(sourceId);
    const result = analyzeBytes(source.bytes, { traceBudget, watchIndex: index });
    const record = result.trace.find((item) => item.index === index);
    if (!record) throw new ApiError("EXPLANATION_UNAVAILABLE", "该下标没有可解释步骤");
    return { index, z: result.z[index], record, stats: result.stats };
  }

  exportReport(sourceId: string) {
    const source = this.getSource(sourceId);
    const report = this.getReport(sourceId);
    return {
      source: {
        id: source.id,
        createdAt: source.createdAt,
        inputEncoding: source.inputEncoding,
        sha256: source.sha256,
        byteLength: source.bytes.length,
        previewText: source.previewText
      },
      report: {
        id: report.id,
        createdAt: report.createdAt,
        result: report.result
      }
    };
  }

  private decodeRequest(request: AnalyzeInputRequest): DecodedInput {
    if (typeof request.text !== "string") throw new ApiError("INVALID_INPUT", "text 必须是字符串");
    return decodeInput(request.text, request.encoding ?? "utf8", request.maxBytes);
  }
}

export function createService(dataDir = resolve("data")): AnalysisService {
  return new AnalysisService(new AnalysisRepository(resolve(dataDir, "z-analysis.sqlite")));
}
