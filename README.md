# 本地字节串 Z 数组与真边界核验服务

这是一个只包含后端 API 与 CLI 的 TypeScript / Node.js / SQLite 项目。它对输入的原始字节串运行自行实现的线性 Z 算法，输出 Z 数组、非空真边界、每个前缀在全文中的重叠出现次数，并保存源字节和正式结果到项目内 SQLite 数据目录。

## 环境

- Windows、PowerShell 或命令提示符
- Node.js 22.5 或更高版本；本项目在 Node.js 25.5 上验证
- 不依赖 Docker、WSL、付费服务或在线 API
- SQLite 使用 Node.js 内置实验模块 `node:sqlite`，无需安装原生编译工具链

Node 运行时可能输出 `ExperimentalWarning: SQLite is an experimental feature`，不影响结果。

## 快速开始

```powershell
npm install
npm run build
npm test
npm run demo
npm start
```

默认数据文件为 `data/z-analysis.sqlite`。服务默认使用端口 `0`，由操作系统选择空闲端口；启动日志会显示实际地址，例如 `http://127.0.0.1:63212`。

指定端口和数据目录：

```powershell
node dist/cli/index.js serve --port 5173 --data-dir data
```

## 字节语义

- 所有分析都按 UTF-8 解码后的 `Buffer` 字节执行，偏移为零基字节偏移。
- 中文等多字节字符不会按 UTF-16 码元或可见字符索引分析。
- 不做 Unicode 归一化、大小写转换或分词。
- 原文可以作为展示字段保存，但计算只依赖原始字节。
- 十六进制输入接受空白字符；必须有偶数个十六进制数字。

例如 `中文中文` 中每个汉字的 UTF-8 长度是 3 字节，全串长度为 12，第二次出现从字节偏移 6 开始，而不是字符偏移 2。

## 算法定义

对长度为 `n` 的字节串 `s`：

- 固定 `Z[0] = 0`。
- 对 `i > 0`，`Z[i]` 是从字节偏移 `i` 开始的后缀与全串前缀相同的最大字节长度。
- 最右匹配区间表示为半开区间 `[l,r)`。
- 当 `i < r` 时，初始长度取 `min(Z[i-l], r-i)`；之后只比较初始长度之外的必要字节。
- `Z[i]` 可以恰好延伸到串尾，这是正常匹配，不是缺字节。
- 统计中的 `reusedComparisons` 是由 Z 盒复用的可证明比较量，`explicitByteComparisons` 是扫描中真实执行的字节相等/不等比较次数。

步骤记录直接在扫描时写入，包括复用前的盒区间、复用来源、初始长度、实际比较数和更新后的盒区间；不是先用朴素算法算出答案后再补造。

## 真边界

长度 `k` 是非空真边界，当且仅当：

```text
1 <= k < n
Z[n-k] = k
```

报告按长度升序输出，并给出后缀起点 `n-k`。空串和单字节串没有非空真边界，全串本身不算真边界。

`ababab` 的结果：

- `k=2`，后缀起点 `4`
- `k=4`，后缀起点 `2`

## 重叠出现次数

长度 `k` 的前缀：

- 在起点 `0` 出现一次；
- 在 `i > 0` 出现，当且仅当 `Z[i] >= k`。

因此允许重叠。`aaaa` 的前缀长度 1、2、3、4 分别出现 4、3、2、1 次。

全部前缀次数通过 Z 值直方图加后缀累加一次得到，不为每个长度重新扫描全文。具体位置查询受 `limit` 和 `offset` 控制；分页只截断展示，不影响准确总数。

## CLI

分析 UTF-8 文本：

```powershell
node dist/cli/index.js analyze --text "aabcaabxaaaz"
```

分析十六进制，零字节用 `00`：

```powershell
node dist/cli/index.js analyze --text "610061" --encoding hex
```

从文件导入：

```powershell
node dist/cli/index.js import --file .\input.txt --encoding utf8
node dist/cli/index.js analyze --file .\input.hex --encoding hex
```

只保存源字节：

```powershell
node dist/cli/index.js import --text "ababab"
```

查询：

```powershell
node dist/cli/index.js report <sourceId>
node dist/cli/index.js borders <sourceId>
node dist/cli/index.js index <sourceId> 4
node dist/cli/index.js count <sourceId> 2
node dist/cli/index.js positions <sourceId> 2 --limit 10 --offset 0
node dist/cli/index.js explain <sourceId> 4
```

生成可重复的长串：

```powershell
node dist/cli/index.js generate repeated --length 10000
node dist/cli/index.js generate alternating --length 10000
```

所有命令都可加 `--data-dir <目录>`。

## HTTP API

### `GET /health`

健康检查。

### `POST /analyses`

一次性导入并分析：

```json
{
  "text": "ababab",
  "encoding": "utf8",
  "maxBytes": 2000000,
  "traceBudget": 4096
}
```

`encoding` 支持 `utf8`、`hex`、`base64`，默认 `utf8`。`traceBudget` 默认为 4096，可以设置为 0。

### `POST /sources`

只保存源字节，不生成报告。

### `POST /sources/:id/analyses`

针对已保存源字节生成新报告。重启后查询始终读取数据库中的原字节，不会从某个外部文件路径静默重算另一份串。

### 查询接口

- `GET /sources/:id`：查看源元数据和十六进制字节
- `GET /sources/:id/report`：完整 JSON 导出
- `GET /sources/:id/borders`：查看真边界
- `GET /sources/:id/indices/:index`：查看某零基字节偏移及其 Z 值
- `GET /sources/:id/prefixes/:length`：查看某前缀准确次数
- `GET /sources/:id/prefixes/:length?positions=true&limit=100&offset=0`：分页查看出现位置
- `GET /sources/:id/explain/:index?traceBudget=4096`：查看单步线性过程解释

### 批量接口

`POST /batch-analyses` 接收：

```json
{
  "items": [
    { "text": "aaaa" },
    { "text": "abc", "encoding": "utf8" }
  ]
}
```

逐项返回结果。单项失败会返回该项的 `ok:false` 和错误码，不会生成看似成功的空数组。

## 错误码

- `INVALID_INPUT`：输入不是字符串
- `UNKNOWN_ENCODING`：未知编码选项
- `INVALID_HEX`：非法或奇数长度十六进制
- `INVALID_BASE64`：非法 Base64
- `INPUT_TOO_LARGE` / `FILE_TOO_LARGE`：超过字节上限
- `FILE_READ_FAILED`：文件无法读取
- `INVALID_INDEX`：下标越界
- `INVALID_PREFIX_LENGTH`：前缀长度越界
- `INVALID_LIMIT` / `INVALID_OFFSET`：分页参数不合法
- `INVALID_TRACE_BUDGET`：解释预算不合法
- `SOURCE_NOT_FOUND` / `REPORT_NOT_FOUND`：数据库对象不存在
- `INVALID_JSON` / `REQUEST_TOO_LARGE`：HTTP 请求无效

## 持久化内容

SQLite 中包含：

- 源字节 BLOB
- 输入编码方式
- SHA-256 摘要
- UTF-8 输入的原文展示字段（可选）
- 算法版本 `z-linear-byte-v1`
- 完整正式结果 JSON：Z 数组、边界、全部前缀计数、性能统计
- 预算内的详细步骤记录

当步骤被省略时，`traceRecordsOmitted` 为 `true`，并保留预算、保留数量和全局汇总；指定位置解释可重新针对数据库原字节计算该位置的在线过程。

## 测试

```powershell
npm test
```

测试覆盖：

- 手写固定数组 `aabcaabxaaaz`
- `ababab` 真边界及前缀次数
- 全相同、无重复、零字节、中文多字节和空输入
- 100 组短随机字节串
- 独立朴素逐字节算法核对全部 Z 值、边界、前缀位置
- 每个报告位置都能从源字节切出相同前缀
- SQLite 关闭后重新打开仍读取原字节和报告
- 非法十六进制拒绝

## 限制与假设

- 默认输入上限为 2,000,000 字节，HTTP 请求体上限为 8,000,000 字节，可用参数调整。
- 这是本地单用户后端，没有认证、TLS、前端页面或任务队列。
- 只分析单个字节串的前缀关系；不建立多模式词典，不做拼写纠错，不做全局重复片段排名。
- SQLite 模块随 Node.js 发布，当前带有实验性警告；如未来 Node 版本改变 API，需要随该版本适配。
