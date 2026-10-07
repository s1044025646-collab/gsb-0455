import path from 'node:path';
import { AppError } from './errors.js';

export interface AppConfig {
  dataDir: string;
  dbPath: string;
  maxInputBytes: number;
  defaultTraceBudget: number;
  maxTraceBudget: number;
  maxPageSize: number;
  algorithmVersion: string;
  port: number | undefined;
}

function intFromEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return undefined;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value)) throw new AppError('BAD_REQUEST', `环境变量 ${name} 必须是整数`);
  return value;
}

export function loadConfig(): AppConfig {
  const dataDir = process.env.Z_DATA_DIR
    ? path.resolve(process.env.Z_DATA_DIR)
    : path.resolve(process.cwd(), 'data');
  const maxInputBytes = intFromEnv('Z_MAX_INPUT_BYTES') ?? 16 * 1024 * 1024;
  const defaultTraceBudget = intFromEnv('Z_TRACE_BUDGET') ?? 2048;
  const maxTraceBudget = intFromEnv('Z_MAX_TRACE_BUDGET') ?? 100_000;
  const maxPageSize = intFromEnv('Z_MAX_PAGE_SIZE') ?? 1000;
  const portEnv = intFromEnv('Z_PORT');
  const portArg = process.argv.find((a) => a.startsWith('--port='))?.split('=')[1];
  const port = portArg !== undefined ? Number.parseInt(portArg, 10) : portEnv;
  return {
    dataDir,
    dbPath: process.env.Z_DB_PATH ? path.resolve(process.env.Z_DB_PATH) : path.join(dataDir, 'zinspect.db'),
    maxInputBytes,
    defaultTraceBudget,
    maxTraceBudget,
    maxPageSize,
    algorithmVersion: 'linear-z/1.0.0',
    port: port !== undefined && Number.isInteger(port) ? port : undefined,
  };
}
