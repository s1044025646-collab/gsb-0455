import { createHash } from 'node:crypto';
import { AppError } from './errors.js';

export type InputEncoding = 'utf8' | 'hex';

const ENCODINGS: ReadonlySet<string> = new Set(['utf8', 'hex']);

export function parseEncoding(value: unknown): InputEncoding {
  const v = typeof value === 'string' ? value.toLowerCase() : 'utf8';
  if (!ENCODINGS.has(v)) {
    throw new AppError('UNKNOWN_ENCODING', `未知编码选项: ${String(value)}（仅支持 utf8 或 hex）`);
  }
  return v as InputEncoding;
}

export function decodeInput(raw: string, encoding: InputEncoding, maxBytes: number): Uint8Array {
  if (raw.length === 0) {
    throw new AppError('EMPTY_PAYLOAD', '输入为空：请提供非空文本或十六进制串（空串分析请显式使用 analyze-empty 语义，本接口拒绝空载荷）');
  }
  let bytes: Uint8Array;
  if (encoding === 'hex') {
    const normalized = raw.trim().replace(/\s+/g, '');
    if (!/^[0-9a-fA-F]*$/.test(normalized)) {
      throw new AppError('INVALID_HEX', '无效十六进制：只允许 0-9、a-f、A-F 与空白');
    }
    if (normalized.length % 2 !== 0) {
      throw new AppError('HEX_ODD_LENGTH', '十六进制串长度为奇数，无法按字节解析');
    }
    bytes = new Uint8Array(normalized.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Number.parseInt(normalized.substr(i * 2, 2), 16);
    }
  } else {
    bytes = Buffer.from(raw, 'utf8');
  }
  if (bytes.length === 0) {
    throw new AppError('EMPTY_PAYLOAD', '输入解码后为 0 字节');
  }
  if (bytes.length > maxBytes) {
    throw new AppError(
      'INPUT_TOO_LARGE',
      `输入 ${bytes.length} 字节超过上限 ${maxBytes} 字节`,
      413,
      { actualBytes: bytes.length, maxBytes },
    );
  }
  return bytes;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
