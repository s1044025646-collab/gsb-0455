# Z 数组前缀匹配与边界出现次数核验后端

本地运行的字节串前缀结构分析服务：输入 UTF-8 文本或十六进制字节串，计算 **Z 数组**、找出**非空真边界**、统计每个前缀在全文中的**重叠出现次数**，并支持按位置分页查询、逐步解释与结果核验。只做 API 与 CLI，纯后端。

- 语言/运行时：TypeScript + Node.js（需 Node ≥ 22.5，开发环境为 Node 25）
- 数据库：SQLite（使用 Node 内置 `node:sqlite`，**无需** Docker、WSL、编译器或任何在线服务）
- 算法：项目内自行实现的线性 Z 算法（`src/zalgorithm.ts`），另有独立朴素实现仅用于测试对拍

## 快速开始（Windows PowerShell）

```powershell
npm install
npm test          # 构建 + 21 项测试（对拍、边界、跨进程持久化）
npm run demo      # 已知样例自动核对（aabcaabxaaaz / ababab / aaaa / 空串）
npm start         # 启动 HTTP 服务，默认端口 0 = 自动选空闲端口，启动行打印实际端口
```

CLI：

```powershell
node --no-warnings dist/src/cli.js analyze --text "aabcaabxaaaz"
node --no-warnings dist/src/cli.js analyze --hex "e4b8ade4b8ad"   # “中中”
node --no-warnings dist/src/cli.js analyze-empty
node --no-warnings dist/src/cli.js borders --id 1
node --no-warnings dist/src/cli.js count   --id 1 --length 2
node --no-warnings dist/src/cli.js positions --id 1 --length 2 --page 0 --page-size 100
node --no-warnings dist/src/cli.js z --id 1 --index 4
node --no-warnings dist/src/cli.js explain --id 1 --index 4
node --no-warnings dist/src/cli.js verify --id 1 --length 3
node --no-warnings dist/src/cli.js sample --kind repeat --length 100000
node --no-warnings dist/src/cli.js sample --kind alternate --length 100000 --alphabet ab
node --no-warnings dist/src/cli.js serve     # 等价 npm start
node --no-warnings dist/src/cli.js help
```

## 字节偏移与口径

- **一切按字节、零基偏移解释。** UTF-8 输入先编码为字节再分析；例如“中中”是 6 字节 `E4 B8 AD E4 B8 AD`，Z 数组为 `[0,0,0,3,0,0]`，匹配起点是字节偏移 3，而**不是** UTF-16 字符索引 1。原文仅用于展示，不做任何 Unicode 归一化。
- 输出 Z 数组长度始终等于输入**字节**长度；`Z[0]` 固定为 0。
- 对 `i>0`，`Z[i]` 是从字节偏移 `i` 开始的后缀与全串前缀相同的最大字节长度。某 `Z` 值恰好触及串尾（`i+Z[i]=n`）是正常完整匹配，不是缺字节。
- **真边界（border）**：长度 `k` 同时是前缀和后缀，且满足 `1 ≤ k < n` 与 `Z[n-k] == k`；按长度升序输出，附带后缀起点 `n-k`。全串本身、空串都不是真边界；空串和单字节串边界清单为空。
- **前缀出现次数按重叠计数**：长度 `k` 前缀在 `i>0` 处出现当且仅当 `Z[i] ≥ k`，再加上起点 0 的一次。因此 `aaaa` 的长度 1..4 前缀次数分别为 **4, 3, 2, 1**（不是不重叠搜索的结果）。
- 次数由 Z 值直方图 + 差分后缀累加在 O(n) 内一次算出，不按每个长度重新扫描。
- 空输入：`POST /api/analyze-empty` 或 `analyze-empty` 返回空 Z 数组、空统计；不存在“长度 0 前缀无限次出现”的说法。普通 analyze 显式拒绝空载荷（`EMPTY_PAYLOAD`）。

## 线性算法过程与可解释性

实现维护最右匹配区间 `[l, r)`：

1. 当 `i < r` 时，初始值取 `min(Z[i-l], r-i)`：`Z[i-l] < r-i` 时直接复用，否则钳到 `r-i`，被复用的长度计入 `reusedInitTotal`，且这部分**不做比较**。
2. 只在初始化区间之外继续逐字节比较；循环条件 `i+k < n` 保证右端不越界，停止时的不相等比较也计入 `comparisons`。
3. 当 `i+Z[i] > r` 时更新 `[l, r)`。

每条保留的步骤记录含：位置、初始化值与来源（`reuse-z` / `reuse-clamped-r` / `outside` / `zero`）、复用长度、每次显式比较的偏移与结果、更新前后的 `[l,r)`。这解释了“为什么该位置得到该长度”，而不是事后伪造。

比较日志有预算：默认每报告保留前 2048 个位置（`Z_TRACE_BUDGET`，上限 `Z_MAX_TRACE_BUDGET`），超限时 `trace.truncated=true`；Z 值、次数等**正式结果不受预算影响**。大规模下可用 `--only-index`/`onlyIndex` 只保留指定位置；对历史报告调用 explain 时会对**数据库中保存的原字节**做定点重算，不会去读外部文件。

## 持久化

- SQLite 文件默认在项目内 `data/zinspect.db`（可用 `Z_DATA_DIR` / `Z_DB_PATH` 改）。
- 保存：原始字节 BLOB、输入编码、原始 UTF-8 文本（hex 输入不回填）、SHA-256、算法版本、完整正式结果 JSON、创建时间。
- 修改输入（不同字节 → 不同 SHA-256）会生成新报告；进程重启后查询仍以库里的原字节为准，绝不从当前外部文件静默重算另一份串。

## HTTP API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/analyze` | body：`{text}` 或 `{hex}`，可选 `encoding`、`traceBudget`、`onlyIndex` |
| POST | `/api/analyze-empty` | 空输入分析 |
| POST | `/api/batch` | body：`{items:[...]}`，逐项成功/失败，失败不产生伪空数组 |
| GET | `/api/reports` | 列表（`limit`/`offset`） |
| GET | `/api/reports/:id` | 完整报告 JSON（导出） |
| GET | `/api/reports/:id/z/:index` | 查询单个下标的 Z 值 |
| GET | `/api/reports/:id/borders` | 真边界清单 |
| GET | `/api/reports/:id/prefixes/:k/count` | 长度 k 前缀准确总次数 |
| GET | `/api/reports/:id/prefixes/:k/positions?page&pageSize` | 出现位置分页（含重叠） |
| GET | `/api/reports/:id/explain/:index` | 该位置的线性算法步骤解释 |
| GET | `/api/reports/:id/verify/:k` | 核验每个位置都能从源字节切出相同前缀 |
| POST | `/api/samples` | body：`{kind:"repeat"\|"alternate", length, alphabet?}` |
| GET | `/health` | 健康检查 |

位置分页截断只影响展示，`total` 始终是直方图算出的准确总次数。

### curl 示例

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:<port>/api/analyze `
  -ContentType 'application/json; charset=utf-8' -Body '{"text":"ababab"}'
```

## 错误码

`EMPTY_PAYLOAD`、`UNKNOWN_ENCODING`、`INVALID_HEX`、`HEX_ODD_LENGTH`、`INPUT_TOO_LARGE`(413)、`NOT_FOUND`(404)、`INVALID_INDEX`、`INVALID_PREFIX_LENGTH`、`INVALID_PAGINATION`、`INVALID_LIMIT`、`BAD_REQUEST`。响应体统一为 `{ "error": { "code", "message", "details?" } }`。

## 配置（环境变量）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `Z_PORT` | `0`（空闲端口） | HTTP 端口，也可用 `--port=N` |
| `Z_DATA_DIR` | `./data` | 数据目录 |
| `Z_DB_PATH` | `<dataDir>/zinspect.db` | SQLite 路径 |
| `Z_MAX_INPUT_BYTES` | `16777216` | 输入字节上限 |
| `Z_TRACE_BUDGET` | `2048` | 默认详细步骤条数 |
| `Z_MAX_TRACE_BUDGET` | `100000` | 单次可请求上限 |
| `Z_MAX_PAGE_SIZE` | `1000` | 位置分页每页上限 |

## 测试与核验方式

- 手写数组核对：`aabcaabxaaaz` → `[0,1,0,0,3,1,0,0,2,2,1,0]`；`ababab` 真边界长度 2、4，长度 2 出现 3 次、长度 4 出现 2 次。
- 对固定短串与 200 组伪随机字节串（含零字节、小字母表高重复），用**独立朴素逐字节比较**交叉检查全部 Z 值、边界和每个长度的出现位置；并逐字节核验“报告给出的每个位置都能从源字节切出同样前缀”。
- 覆盖全相同、无重复、零字节、中文多字节（按字节偏移）、空输入；以及 CLI 多次调用（即跨进程）读取同一份 SQLite 旧结果。

## 已知限制

- 单次分析在内存中持有字节与 Z 数组，受 `Z_MAX_INPUT_BYTES` 约束；超长输入请先调大上限。
- 详细比较日志是可选的解释性数据，默认有预算截断；统计结果始终精确。
- 仅分析单串的前缀关系：不建多模式词典、不做拼写纠错、不做全局重复片段排名。
