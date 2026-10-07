import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { ApiError } from "../errors.js";

export type InputEncoding = "utf8" | "hex" | "base64";

export interface DecodedInput {
  bytes: Buffer;
  inputEncoding: InputEncoding;
  sha256: string;
  previewText?: string;
}

export const DEFAULT_MAX_BYTES = 2_000_000;

export function decodeInput(payload: string, encoding: InputEncoding, maxBytes = DEFAULT_MAX_BYTES): DecodedInput {
  if (typeof payload !== "string") {
    throw new ApiError("INVALID_INPUT", "输入必须是字符串");
  }
  if (!["utf8", "hex", "base64"].includes(encoding)) {
    throw new ApiError("UNKNOWN_ENCODING", "encoding 仅支持 utf8、hex、base64");
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new ApiError("INVALID_LIMIT", "maxBytes 必须是正安全整数");
  }

  let bytes: Buffer;
  if (encoding === "utf8") {
    bytes = Buffer.from(payload, "utf8");
  } else if (encoding === "hex") {
    const normalized = payload.replace(/\s+/g, "");
    if (!/^(?:[0-9a-fA-F]{2})*$/.test(normalized)) {
      throw new ApiError("INVALID_HEX", "十六进制必须只包含偶数个 0-9a-f 字符");
    }
    bytes = Buffer.from(normalized, "hex");
  } else {
    const normalized = payload.replace(/\s+/g, "");
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized)) {
      throw new ApiError("INVALID_BASE64", "Base64 格式无效");
    }
    bytes = Buffer.from(normalized, "base64");
    if (bytes.toString("base64").replace(/=+$/, "") !== normalized.replace(/=+$/, "")) {
      throw new ApiError("INVALID_BASE64", "Base64 无法严格解码为字节");
    }
  }

  if (bytes.length > maxBytes) {
    throw new ApiError("INPUT_TOO_LARGE", `输入超过 ${maxBytes} 字节上限`, 413, {
      byteLength: bytes.length,
      maxBytes
    });
  }

  return {
    bytes,
    inputEncoding: encoding,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    ...(encoding === "utf8" ? { previewText: payload } : {})
  };
}

export async function decodeFile(path: string, encoding: InputEncoding, maxBytes = DEFAULT_MAX_BYTES): Promise<DecodedInput> {
  let raw: Buffer;
  try {
    raw = await readFile(path);
  } catch (error) {
    throw new ApiError("FILE_READ_FAILED", "无法读取输入文件", 400, { path, reason: (error as Error).message });
  }
  if (raw.length > maxBytes) {
    throw new ApiError("FILE_TOO_LARGE", `文件超过 ${maxBytes} 字节上限`, 413, {
      byteLength: raw.length,
      maxBytes
    });
  }
  if (encoding === "utf8") return decodeInput(raw.toString("utf8"), "utf8", maxBytes);
  if (encoding === "hex") return decodeInput(raw.toString("ascii"), "hex", maxBytes);
  return decodeInput(raw.toString("ascii"), "base64", maxBytes);
}

export function repeatedBytePattern(byteValue: number, unitLength: number, repeats: number): Buffer {
  if (!Number.isSafeInteger(byteValue) || byteValue < 0 || byteValue > 255) {
    throw new ApiError("INVALID_BYTE", "byteValue 必须在 0 到 255 之间");
  }
  if (!Number.isSafeInteger(unitLength) || unitLength < 1 || !Number.isSafeInteger(repeats) || repeats < 1) {
    throw new ApiError("INVALID_GENERATOR", "unitLength 和 repeats 必须是正安全整数");
  }
  return Buffer.alloc(unitLength * repeats, byteValue);
}

export function alternatingBytes(length: number, first = 97, second = 98): Buffer {
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new ApiError("INVALID_GENERATOR", "length 必须是非负安全整数");
  }
  if (![first, second].every((value) => value >= 0 && value <= 255)) {
    throw new ApiError("INVALID_BYTE", "交替字节必须在 0 到 255 之间");
  }
  return Buffer.from(Array.from({ length }, (_, index) => (index % 2 === 0 ? first : second)));
}
