import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { loadConfig } from './config.js';
import { AppError, type ErrorCode } from './errors.js';
import { ZService, generateSample } from './service.js';

const config = loadConfig();
const service = new ZService(config);

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(json);
}

function readBody(req: IncomingMessage, maxBytes = config.maxInputBytes * 2 + 65536): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        reject(new AppError('INPUT_TOO_LARGE', `请求体超过 ${maxBytes} 字节`, 413));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req: IncomingMessage): Promise<any> {
  const raw = await readBody(req);
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError('BAD_REQUEST', '请求体不是合法 JSON');
  }
}

function intParam(value: string | null, name: string, fallback?: number): number {
  if (value === null || value === undefined) {
    if (fallback !== undefined) return fallback;
    throw new AppError('BAD_REQUEST', `缺少参数 ${name}`);
  }
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n)) throw new AppError('BAD_REQUEST', `参数 ${name} 必须是整数`);
  return n;
}

const routes: Array<{ method: string; pattern: RegExp; keys: string[] }> = [
  { method: 'POST', pattern: /^\/api\/analyze$/, keys: [] },
  { method: 'POST', pattern: /^\/api\/analyze-empty$/, keys: [] },
  { method: 'POST', pattern: /^\/api\/batch$/, keys: [] },
  { method: 'GET', pattern: /^\/api\/reports$/, keys: [] },
  { method: 'GET', pattern: /^\/api\/reports\/(\d+)$/, keys: ['id'] },
  { method: 'GET', pattern: /^\/api\/reports\/(\d+)\/z\/(-?\d+)$/, keys: ['id', 'index'] },
  { method: 'GET', pattern: /^\/api\/reports\/(\d+)\/borders$/, keys: ['id'] },
  { method: 'GET', pattern: /^\/api\/reports\/(\d+)\/prefixes\/(\d+)\/count$/, keys: ['id', 'k'] },
  { method: 'GET', pattern: /^\/api\/reports\/(\d+)\/prefixes\/(\d+)\/positions$/, keys: ['id', 'k'] },
  { method: 'GET', pattern: /^\/api\/reports\/(\d+)\/explain\/(\d+)$/, keys: ['id', 'index'] },
  { method: 'GET', pattern: /^\/api\/reports\/(\d+)\/verify\/(\d+)$/, keys: ['id', 'k'] },
  { method: 'POST', pattern: /^\/api\/samples$/, keys: [] },
];

async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/health') {
    send(res, 200, { ok: true, algorithmVersion: config.algorithmVersion });
    return;
  }
  const route = routes.find((rt) => rt.method === req.method && rt.pattern.test(url.pathname));
  if (!route) {
    send(res, 404, { error: { code: 'NOT_FOUND', message: `无此路由: ${req.method} ${url.pathname}` } });
    return;
  }
  const match = url.pathname.match(route.pattern)!;
  const params: Record<string, number> = {};
  route.keys.forEach((key, i) => (params[key] = Number.parseInt(match[i + 1]!, 10)));

  switch (url.pathname.replace(/\d+/g, '{n}')) {
    case '/api/analyze': {
      const body = await readJson(req);
      send(res, 200, service.analyze(body));
      break;
    }
    case '/api/analyze-empty':
      send(res, 200, service.analyzeEmpty());
      break;
    case '/api/batch': {
      const body = await readJson(req);
      if (!Array.isArray(body?.items)) throw new AppError('BAD_REQUEST', 'body.items 必须是数组');
      send(res, 200, { results: service.batch(body.items) });
      break;
    }
    case '/api/reports':
      send(res, 200, {
        reports: service.list(intParam(url.searchParams.get('limit'), 'limit', 50), intParam(url.searchParams.get('offset'), 'offset', 0)),
      });
      break;
    case '/api/reports/{n}':
      send(res, 200, service.get(params.id!));
      break;
    case '/api/reports/{n}/z/{n}':
      send(res, 200, service.zAt(params.id!, params.index!));
      break;
    case '/api/reports/{n}/borders':
      send(res, 200, { borders: service.borders(params.id!) });
      break;
    case '/api/reports/{n}/prefixes/{n}/count':
      send(res, 200, service.prefixCount(params.id!, params.k!));
      break;
    case '/api/reports/{n}/prefixes/{n}/positions':
      send(
        res,
        200,
        service.prefixPositions(
          params.id!,
          params.k!,
          intParam(url.searchParams.get('page'), 'page', 0),
          intParam(url.searchParams.get('pageSize'), 'pageSize', 100),
        ),
      );
      break;
    case '/api/reports/{n}/explain/{n}':
      send(res, 200, await service.explain(params.id!, params.index!));
      break;
    case '/api/reports/{n}/verify/{n}':
      send(res, 200, service.verifyPositions(params.id!, params.k!));
      break;
    case '/api/samples': {
      const body = await readJson(req);
      send(res, 200, generateSample(body.kind === 'alternate' ? 'alternate' : 'repeat', intParam(String(body.length ?? 10), 'length', 10), body.alphabet));
      break;
    }
  }
}

const server = createServer((req, res) => {
  handler(req, res).catch((err: unknown) => {
    if (err instanceof AppError) {
      send(res, err.status, { error: { code: err.code, message: err.message, details: err.details } });
    } else {
      send(res, 500, { error: { code: 'INTERNAL' as ErrorCode, message: (err as Error).message } });
    }
  });
});

function listen(port: number): Promise<number> {
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve((server.address() as { port: number }).port));
  });
}

/** 默认选择空闲端口：传 0 让操作系统分配。 */
const requested = config.port ?? 0;
listen(requested).then((actual) => {
  console.log(JSON.stringify({ status: 'listening', url: `http://127.0.0.1:${actual}`, port: actual, dataDir: config.dataDir }));
});

export { server };
