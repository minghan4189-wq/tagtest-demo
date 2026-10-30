# 测图作战台 · 本地账号演示

**性质：本地技术演示，不是 SaaS / 不是公网产品。** 仅用账号 ID（无密码）区分数据目录，方便同一浏览器体验「多账号状态隔离」。

## 需要什么

- Node.js ≥ 16（零第三方依赖）

## 怎么跑

```bash
cd /workspace/tagtest-demo
npm start
# 默认监听 http://127.0.0.1:3789/
# 可用环境变量改端口：PORT=4000 npm start
```

浏览器打开：<http://127.0.0.1:3789/>

1. 输入账号 ID（例如 `demo_a`）→ 进入作战台  
2. 随便改一点数据（标准参数 / 创意等）  
3. 点「切换账号」，再进 `demo_b` → 应看到空/另一份状态  
4. 再切回 `demo_a` → 之前的数据还在  

「导出 JSON / 导入 / 清空全部」仍可用；清空会把**当前账号**的服务端 `state.json` 一并写成默认空状态。

## API（演示用）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/login` | body `{ "accountId" }` → 规范化并建目录 |
| GET | `/api/state?accountId=` | 取该账号 JSON；无则 `empty:true` |
| PUT | `/api/state` | body `{ "accountId", "state" }` → 落盘 |
| GET | `/api/accounts` | 列出已知账号（便利） |
| GET | `/api/health` | 健康检查 |

数据目录：`data/<hex(accountId)>/state.json`（账号 ID 做 hex 编码，防路径穿越）。

## 已知限制（如实）

- **无密码 / 无鉴权**：知道账号 ID 即可读写该账号状态；只适合本机演示。  
- **base64 图片**：状态 JSON 可能很大；服务端单请求上限约 50MB；浏览器 localStorage 离线缓存仍可能配额失败（失败时以服务端为准，缓存失败会忽略）。  
- **未做并发锁**：同账号多标签同时写可能互相覆盖（演示可接受）。  
- **仅绑定 127.0.0.1**：不对外网暴露。  
- **非产品化**：无备份策略、无迁移工具、无多机同步。

## 目录

```
tagtest-demo/
  package.json
  server.js
  README.md
  public/index.html   # 作战台 UI + 登录门 + API 存取
  data/               # 运行后生成，按账号隔离
```
