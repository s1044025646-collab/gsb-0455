import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { AnalysisService } from "./service.js";
import { ApiError, isApiError } from "./errors.js";

interface JsonRequestBody {
  [key: string]: unknown;
  text?: unknown;
  encoding?: unknown;
  maxBytes?: unknown;
  traceBudget?: unknown;
  index?: unknown;
  prefixLength?: unknown;
  limit?: unknown;
  offset?: unknown;
}

async function readJson(request: IncomingMessage): Promise<JsonRequestBody> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const body = Buffer.concat(chunks);
  if (body.length > 8_000_000) throw new ApiError("REQUEST_TOO_LARGE", "HTTP 请求体超过 8MB", 413);
  if (body.length === 0) return {};
  try {
    return JSON.parse(body.toString("utf8")) as JsonRequestBody;
  } catch {
    throw new ApiError("INVALID_JSON", "请求体必须是 UTF-8 JSON");
  }
}

function asPositiveInteger(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  const numberValue = Number(value);
  if (!Number.isSafeInteger(numberValue) || numberValue < 1) {
    throw new ApiError("INVALID_PARAMETER", `${name} 必须是正安全整数`);
  }
  return numberValue;
}

function asNonNegativeOptional(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  return asNonNegativeInteger(value, name);
}

function asNonNegativeInteger(value: unknown, name: string): number {
  const numberValue = Number(value);
  if (!Number.isSafeInteger(numberValue) || numberValue < 0) {
    throw new ApiError("INVALID_PARAMETER", `${name} 必须是非负安全整数`);
  }
  return numberValue;
}

function matchPath(pathname: string, pattern: string): string[] | null {
  const actual = pathname.split("/").filter(Boolean);
  const expected = pattern.split("/").filter(Boolean);
  if (actual.length !== expected.length) return null;
  const params: string[] = [];
  for (let i = 0; i < expected.length; i++) {
    if (expected[i]?.startsWith(":")) params.push(decodeURIComponent(actual[i] ?? ""));
    else if (expected[i] !== actual[i]) return null;
  }
  return params;
}

export function createApp(service: AnalysisService): Server {
  return createServer(async (request, response) => {
    const send = (status: number, payload: unknown) => {
      response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(payload));
    };

    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const method = request.method ?? "GET";

      if (method === "GET" && url.pathname === "/health") {
        send(200, { ok: true });
        return;
      }

      if (method === "POST" && url.pathname === "/sources") {
        const body = await readJson(request);
        const source = service.importSource({
          text: typeof body.text === "string" ? body.text : "",
          encoding: body.encoding as never,
          maxBytes: asPositiveInteger(body.maxBytes, "maxBytes"),
          traceBudget: asNonNegativeOptional(body.traceBudget, "traceBudget")
        });
        send(201, { id: source.id, sha256: source.sha256, byteLength: source.bytes.length });
        return;
      }

      if (method === "POST" && url.pathname === "/analyses") {
        const body = await readJson(request);
        const report = service.analyze({
          text: typeof body.text === "string" ? body.text : "",
          encoding: body.encoding as never,
          maxBytes: asPositiveInteger(body.maxBytes, "maxBytes"),
          traceBudget: asNonNegativeOptional(body.traceBudget, "traceBudget")
        });
        send(201, { sourceId: report.sourceId, reportId: report.id, result: report.result });
        return;
      }

      if (method === "POST" && url.pathname === "/batch-analyses") {
        const body = await readJson(request);
        if (!Array.isArray(body.items)) throw new ApiError("INVALID_BATCH", "items 必须是数组");
        const results = (body.items as JsonRequestBody[]).map((item, position: number) => {
          try {
            const report = service.analyze({
              text: typeof item?.text === "string" ? item.text : "",
              encoding: item?.encoding as never,
              maxBytes: asPositiveInteger(item?.maxBytes, "maxBytes"),
              traceBudget: asNonNegativeOptional(item?.traceBudget, "traceBudget")
            });
            return { position, ok: true, sourceId: report.sourceId, reportId: report.id, result: report.result };
          } catch (error) {
            if (isApiError(error)) return { position, ok: false, code: error.code, message: error.message };
            return { position, ok: false, code: "INTERNAL_ERROR", message: (error as Error).message };
          }
        });
        send(200, { results });
        return;
      }

      let params = matchPath(url.pathname, "/sources/:id/analyses");
      if (method === "POST" && params) {
        const body = await readJson(request);
        const report = service.analyzeSource(params[0]!, asNonNegativeOptional(body.traceBudget, "traceBudget"));
        send(201, { sourceId: report.sourceId, reportId: report.id, result: report.result });
        return;
      }

      params = matchPath(url.pathname, "/sources/:id");
      if (method === "GET" && params) {
        const source = service.getSource(params[0]!);
        send(200, {
          id: source.id,
          inputEncoding: source.inputEncoding,
          sha256: source.sha256,
          byteLength: source.bytes.length,
          previewText: source.previewText,
          hex: source.bytes.toString("hex")
        });
        return;
      }

      params = matchPath(url.pathname, "/sources/:id/report");
      if (method === "GET" && params) {
        send(200, service.exportReport(params[0]!));
        return;
      }

      params = matchPath(url.pathname, "/sources/:id/borders");
      if (method === "GET" && params) {
        send(200, { borders: service.getBorders(params[0]!) });
        return;
      }

      params = matchPath(url.pathname, "/sources/:id/indices/:index");
      if (method === "GET" && params) {
        send(200, service.queryIndex(params[0]!, asNonNegativeInteger(params[1], "index")));
        return;
      }

      params = matchPath(url.pathname, "/sources/:id/prefixes/:length");
      if (method === "GET" && params) {
        const prefixLength = asPositiveInteger(params[1], "prefixLength")!;
        if (url.searchParams.has("positions")) {
          const limit = asPositiveInteger(url.searchParams.get("limit") ?? 100, "limit")!;
          const offset = asNonNegativeInteger(url.searchParams.get("offset") ?? 0, "offset");
          send(200, service.getPrefixPositions(params[0]!, prefixLength, Math.min(limit, 1000), offset));
        } else {
          send(200, service.getPrefixCount(params[0]!, prefixLength));
        }
        return;
      }

      params = matchPath(url.pathname, "/sources/:id/explain/:index");
      if (method === "GET" && params) {
        const traceBudgetValue = url.searchParams.get("traceBudget") ?? "4096";
        const traceBudget = asNonNegativeInteger(traceBudgetValue, "traceBudget");
        send(200, service.explain(params[0]!, asNonNegativeInteger(params[1], "index"), traceBudget));
        return;
      }

      send(404, { error: { code: "NOT_FOUND", message: "路由不存在" } });
    } catch (error) {
      if (isApiError(error)) {
        send(error.status, { error: { code: error.code, message: error.message, details: error.details } });
      } else {
        send(500, { error: { code: "INTERNAL_ERROR", message: (error as Error).message } });
      }
    }
  });
}

export function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolvePort, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolvePort(address.port);
    });
  });
}

