#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { loadConfig } from './config.js';
import { AppError } from './errors.js';
import { ZService, generateSample } from './service.js';

function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function requireArg(args: string[], name: string): string {
  const v = arg(args, name);
  if (v === undefined) throw new AppError('BAD_REQUEST', `缺少参数 --${name}`);
  return v;
}

function print(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

async function main(): Promise<void> {
  const [, , command = 'help', ...rest] = process.argv;
  const config = loadConfig();

  if (command === 'help' || command === '--help') {
    process.stdout.write(helpText);
    return;
  }

  if (command === 'demo') {
    runDemo();
    return;
  }

  if (command === 'serve' || command === 'start') {
    const child = spawn(process.execPath, ['--no-warnings', new URL('./server.js', import.meta.url).pathname], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code) => process.exit(code ?? 0));
    return;
  }

  const service = new ZService(config);
  try {
    switch (command) {
      case 'analyze': {
        const hex = arg(rest, 'hex');
        const file = arg(rest, 'file');
        const text = hex ?? (file ? await readFileArg(file) : requireArg(rest, 'text'));
        const traceBudget = arg(rest, 'trace-budget') ? Number.parseInt(arg(rest, 'trace-budget')!, 10) : undefined;
        const onlyIndex = arg(rest, 'only-index') ? Number.parseInt(arg(rest, 'only-index')!, 10) : undefined;
        print(service.analyze({ hex, text: hex ? undefined : text, traceBudget, onlyIndex }));
        break;
      }
      case 'analyze-empty':
        print(service.analyzeEmpty());
        break;
      case 'get':
        print(service.get(Number.parseInt(requireArg(rest, 'id'), 10)));
        break;
      case 'z':
        print(service.zAt(Number.parseInt(requireArg(rest, 'id'), 10), Number.parseInt(requireArg(rest, 'index'), 10)));
        break;
      case 'borders':
        print({ borders: service.borders(Number.parseInt(requireArg(rest, 'id'), 10)) });
        break;
      case 'count':
        print(
          service.prefixCount(
            Number.parseInt(requireArg(rest, 'id'), 10),
            Number.parseInt(requireArg(rest, 'length'), 10),
          ),
        );
        break;
      case 'positions':
        print(
          service.prefixPositions(
            Number.parseInt(requireArg(rest, 'id'), 10),
            Number.parseInt(requireArg(rest, 'length'), 10),
            Number.parseInt(arg(rest, 'page') ?? '0', 10),
            Number.parseInt(arg(rest, 'page-size') ?? '100', 10),
          ),
        );
        break;
      case 'explain':
        print(
          await service.explain(
            Number.parseInt(requireArg(rest, 'id'), 10),
            Number.parseInt(requireArg(rest, 'index'), 10),
          ),
        );
        break;
      case 'verify':
        print(
          service.verifyPositions(
            Number.parseInt(requireArg(rest, 'id'), 10),
            Number.parseInt(requireArg(rest, 'length'), 10),
          ),
        );
        break;
      case 'list':
        print({ reports: service.list(Number.parseInt(arg(rest, 'limit') ?? '50', 10), Number.parseInt(arg(rest, 'offset') ?? '0', 10)) });
        break;
      case 'sample': {
        const kind = arg(rest, 'kind') === 'alternate' ? 'alternate' : 'repeat';
        const length = Number.parseInt(arg(rest, 'length') ?? '100', 10);
        const sample = generateSample(kind, length, arg(rest, 'alphabet'));
        const report = service.analyze({ text: sample.text, traceBudget: 0 });
        print({ generated: { kind, length }, id: report.id, stats: report.stats, firstZ: report.z.slice(0, 20) });
        break;
      }
      default:
        throw new AppError('BAD_REQUEST', `未知子命令: ${command}`);
    }
  } finally {
    service.close();
  }
}

async function readFileArg(filePath: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  return readFile(filePath, 'utf8');
}

function runDemo(): void {
  const service = new ZService(loadConfig());
  try {
    const expectedZ = [0, 1, 0, 0, 3, 1, 0, 0, 2, 2, 1, 0];
    const r1 = service.analyze({ text: 'aabcaabxaaaz', traceBudget: 100 });
    print({
      demo: 'aabcaabxaaaz',
      expected: expectedZ,
      actual: r1.z,
      pass: JSON.stringify(r1.z) === JSON.stringify(expectedZ),
      comparisons: r1.stats.comparisons,
    });
    const r2 = service.analyze({ text: 'ababab', traceBudget: 100 });
    print({
      demo: 'ababab',
      borders: r2.borders,
      countLength2: r2.prefixCounts[2],
      countLength4: r2.prefixCounts[4],
      pass:
        JSON.stringify(r2.borders) === JSON.stringify([
          { length: 2, suffixStart: 4 },
          { length: 4, suffixStart: 2 },
        ]) && r2.prefixCounts[2] === 3 && r2.prefixCounts[4] === 2,
    });
    const r3 = service.analyze({ text: 'aaaa', traceBudget: 100 });
    print({ demo: 'aaaa', prefixCounts1to4: [r3.prefixCounts[1], r3.prefixCounts[2], r3.prefixCounts[3], r3.prefixCounts[4]], pass: JSON.stringify([r3.prefixCounts[1], r3.prefixCounts[2], r3.prefixCounts[3], r3.prefixCounts[4]]) === JSON.stringify([4, 3, 2, 1]) });
    const r4 = service.analyzeEmpty();
    print({ demo: 'empty', z: r4.z, counts: r4.prefixCounts, pass: r4.z.length === 0 });
  } finally {
    service.close();
  }
}

const helpText = `zinspect — 字节串 Z 数组前缀核验后端（API + CLI）

用法:
  zinspect analyze --text "<utf8文本>" [--trace-budget N] [--only-index I]
  zinspect analyze --hex "<十六进制>" [--trace-budget N]
  zinspect analyze --file <路径>
  zinspect analyze-empty
  zinspect get --id N
  zinspect z --id N --index I
  zinspect borders --id N
  zinspect count --id N --length K
  zinspect positions --id N --length K [--page P] [--page-size S]
  zinspect explain --id N --index I
  zinspect verify --id N --length K
  zinspect list [--limit N] [--offset N]
  zinspect sample --kind repeat|alternate --length N [--alphabet ab]
  zinspect serve
  zinspect demo

环境变量:
  Z_PORT 端口（默认 0 = 自动选空闲端口）
  Z_DATA_DIR 数据目录（默认 ./data）
  Z_MAX_INPUT_BYTES 输入字节上限（默认 16777216）
  Z_TRACE_BUDGET 详细步骤默认保留条数（默认 2048）
  Z_MAX_TRACE_BUDGET 可请求上限（默认 100000）
`;

main().catch((err: unknown) => {
  if (err instanceof AppError) {
    process.stderr.write(JSON.stringify({ error: { code: err.code, message: err.message } }, null, 2) + '\n');
    process.exit(1);
  }
  throw err;
});
