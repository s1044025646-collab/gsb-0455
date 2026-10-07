#!/usr/bin/env node
import { resolve } from "node:path";
import { createService } from "../service.js";
import { createApp, listen } from "../server.js";
import { alternatingBytes } from "../core/input.js";
import { isApiError } from "../errors.js";

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function int(value: string | undefined, name: string, fallback?: number): number {
  if (value === undefined) {
    if (fallback !== undefined) return fallback;
    throw new Error(`缺少参数 --${name}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`--${name} 必须是整数`);
  return parsed;
}

function nonNegativeInt(value: string | undefined, name: string, fallback: number): number {
  const parsed = int(value, name, fallback);
  if (parsed < 0) throw new Error(`--${name} 必须是非负整数`);
  return parsed;
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function dataDir(): string {
  return resolve(option(process.argv.slice(2), "data-dir") ?? "data");
}

function stripDataDirArgs(allArgs: string[]): string[] {
  const result: string[] = [];
  for (let index = 1; index < allArgs.length; index++) {
    if (allArgs[index] === "--data-dir") {
      index++;
      continue;
    }
    if (allArgs[index - 1] === "--data-dir") continue;
    result.push(allArgs[index]!);
  }
  return result;
}

async function main(): Promise<void> {
  const allArgs = process.argv.slice(2);
  const command = allArgs[0];
  const args = stripDataDirArgs(allArgs);
  const service = createService(dataDir());

  try {
    switch (command) {
      case "analyze": {
        const text = option(args, "text") ?? "";
        const filePath = option(args, "file");
        const encoding = (option(args, "encoding") ?? "utf8") as "utf8" | "hex" | "base64";
        const maxBytes = int(option(args, "max-bytes"), "max-bytes", 2_000_000);
        const traceBudget = nonNegativeInt(option(args, "trace-budget"), "trace-budget", 4096);
        if (filePath) {
          console.log(json(await service.analyzeFile(filePath, encoding, maxBytes, traceBudget)));
        } else {
          console.log(json(service.analyze({ text, encoding, maxBytes, traceBudget })));
        }
        break;
      }
      case "import": {
        const text = option(args, "text") ?? "";
        const filePath = option(args, "file");
        const encoding = (option(args, "encoding") ?? "utf8") as "utf8" | "hex" | "base64";
        const maxBytes = int(option(args, "max-bytes"), "max-bytes", 2_000_000);
        if (filePath) {
          const saved = await service.importFile(filePath, encoding, maxBytes);
          console.log(json({ id: saved.id, sha256: saved.sha256, byteLength: saved.bytes.length, inputEncoding: saved.inputEncoding }));
        } else {
          const saved = service.importSource({ text, encoding, maxBytes });
          console.log(json({ id: saved.id, sha256: saved.sha256, byteLength: saved.bytes.length, inputEncoding: saved.inputEncoding }));
        }
        break;
      }
      case "report":
        console.log(json(service.exportReport(args[0] ?? "")));
        break;
      case "source":
        console.log(json(service.getSource(args[0] ?? "")));
        break;
      case "borders":
        console.log(json({ borders: service.getBorders(args[0] ?? "") }));
        break;
      case "index": {
        const [sourceId = "", indexText = "0"] = args;
        console.log(json(service.queryIndex(sourceId, int(indexText, "index", 0))));
        break;
      }
      case "count": {
        const [sourceId = "", lengthText = "1"] = args;
        console.log(json(service.getPrefixCount(sourceId, int(lengthText, "prefixLength", 1))));
        break;
      }
      case "positions": {
        const [sourceId = "", lengthText = "1"] = args;
        const limit = Math.min(int(option(args, "limit"), "limit", 100), 1000);
        const offset = nonNegativeInt(option(args, "offset"), "offset", 0);
        console.log(json(service.getPrefixPositions(sourceId, int(lengthText, "prefixLength", 1), limit, offset)));
        break;
      }
      case "explain": {
        const [sourceId = "", indexText = "1"] = args;
        console.log(json(service.explain(sourceId, int(indexText, "index", 1), nonNegativeInt(option(args, "trace-budget"), "trace-budget", 4096))));
        break;
      }
      case "generate": {
        const kind = args[0] ?? "repeated";
        const length = int(option(args, "length"), "length", 16);
        const bytes = kind === "alternating" ? alternatingBytes(length) : Buffer.alloc(length, 97);
        const saved = service.analyze({
          text: bytes.toString("hex"),
          encoding: "hex",
          traceBudget: nonNegativeInt(option(args, "trace-budget"), "trace-budget", 4096)
        });
        console.log(json(saved));
        break;
      }
      case "serve": {
        const port = int(option(args, "port"), "port", 0);
        const actualPort = await listen(createApp(service), port);
        console.log(`Z 数组分析服务已启动: http://127.0.0.1:${actualPort}`);
        console.log(`数据目录: ${dataDir()}`);
        await new Promise(() => undefined);
        break;
      }
      case "demo": {
        const known = service.analyze({ text: "aabcaabxaaaz", encoding: "utf8" });
        const bordersExample = service.analyze({ text: "ababab", encoding: "utf8" });
        const alternating = service.analyze({ text: alternatingBytes(12).toString("ascii"), encoding: "utf8" });
        console.log(json({
          knownExample: {
            sourceId: known.sourceId,
            z: known.result.z,
            borders: known.result.borders
          },
          alternating: {
            sourceId: alternating.sourceId,
            z: alternating.result.z,
            length2: service.getPrefixCount(alternating.sourceId, 2)
          },
          bordersExample: {
            sourceId: bordersExample.sourceId,
            z: bordersExample.result.z,
            borders: bordersExample.result.borders,
            length2: service.getPrefixCount(bordersExample.sourceId, 2),
            length4: service.getPrefixCount(bordersExample.sourceId, 4)
          }
        }));
        break;
      }
      default:
        console.log(`用法:
  zbyte analyze --text "ababab" [--encoding utf8] [--trace-budget 4096]
  zbyte analyze --file .\input.txt --encoding utf8
  zbyte import --text "ababab"
  zbyte report <sourceId>
  zbyte borders <sourceId>
  zbyte index <sourceId> <index>
  zbyte count <sourceId> <prefixLength>
  zbyte positions <sourceId> <prefixLength> [--limit 100] [--offset 0]
  zbyte explain <sourceId> <index>
  zbyte generate repeated|alternating --length 32
  zbyte serve [--port 0]
  zbyte demo

全局参数: --data-dir data`);
    }
  } catch (error) {
    if (isApiError(error)) {
      console.error(json({ error: { code: error.code, message: error.message, details: error.details } }));
    } else {
      console.error(json({ error: { code: "CLI_ERROR", message: (error as Error).message } }));
    }
    process.exitCode = 1;
  }
}

void main();
