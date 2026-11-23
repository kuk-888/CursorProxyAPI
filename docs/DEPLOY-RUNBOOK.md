# 部署手册（systemd 单机，tar 上传方式）

占位符：`$HOST` 服务器，`$DIR=/opt/cursor-proxy-api`，`$SVC=cursor-proxy-api`，`$GW` 网关本机地址 `http://127.0.0.1:6718`。服务以 `cursorgw` 运行，`$DIR` 目录不是 git 仓库。

## 0. 前置检查（只读）
```bash
ssh root@$HOST 'cd /opt/cursor-proxy-api && for k in GATEWAY_TOKEN ADMIN_PASSWORD CURSOR_API_KEYS DASHBOARD_PATH; do grep -q "^$k=." .env && echo "$k set" || echo "$k MISSING"; done; systemctl is-active cursor-proxy-api; df -h /opt | tail -1'
```
任一变量 MISSING 则不要部署：新版缺 `GATEWAY_TOKEN`/客户端 key 会拒绝启动，缺 `ADMIN_PASSWORD` 则后台禁用。

## 1. 本地构建与验证
```bash
npm ci && npm run typecheck && npm test        # 必须全绿
git rev-parse --short HEAD                      # 记录待部署版本
tar --exclude=node_modules --exclude=.git --exclude='*-star' --exclude=data --exclude='.env*' --exclude='._*' \
    -czf /tmp/cpa-release.tgz package.json package-lock.json tsconfig.json src test dist .env.example
```
依赖 `@cursor/sdk` 版本固定（`package.json`），lock 未变则无需重装 `node_modules`。

## 2. 备份（回滚依据）
```bash
ssh root@$HOST 'set -e; B=/root/cpa-backup-$(date +%Y%m%d-%H%M%S); mkdir -p $B && chmod 700 $B
  tar -C /opt/cursor-proxy-api --exclude=node_modules -czf $B/app.tgz . ; chmod 600 $B/app.tgz
  systemctl cat cursor-proxy-api > $B/unit.txt; echo $B'
```
备份包含 `.env`、`gateway-keys.json`、`admin-session.key`、`usage-ledger.json`，权限 600，勿外传。记下输出的备份目录 `$B`。

## 3. 上传与切换
```bash
scp /tmp/cpa-release.tgz root@$HOST:/tmp/
ssh root@$HOST 'set -e; cd /opt/cursor-proxy-api
  tar -xzf /tmp/cpa-release.tgz --no-same-owner
  chown -R cursorgw:cursorgw /opt/cursor-proxy-api
  # 仅当 package-lock.json 有变化时:
  # sudo -u cursorgw npm ci --omit=dev
  systemctl restart cursor-proxy-api; sleep 3; systemctl is-active cursor-proxy-api
  journalctl -u cursor-proxy-api -n 15 --no-pager | grep -E "gateway_listening|gateway_refused|Error" | cut -c1-200'
```
重启有几秒中断，正在进行的流会断；选低峰（或先通知在线使用者）。

## 4. 上线后冒烟清单
以下在服务器本机对 `$GW` 执行（令牌从 `.env` 读，勿回显）。
```bash
T=$(grep ^GATEWAY_TOKEN= /opt/cursor-proxy-api/.env | cut -d= -f2-)
H="Authorization: Bearer $T"
```
- [ ] `systemctl is-active` = active，日志有 `gateway_listening`，无 `gateway_refused_to_start`
- [ ] `curl -s -o /dev/null -w %{http_code} $GW/health` = 200
- [ ] 无鉴权 `GET /v1/models` = 401；带令牌 = 200 且含预期模型
- [ ] Anthropic 头（`x-api-key` + `anthropic-version`）`GET /v1/models` = 200
- [ ] Chat 非流式：`POST /v1/chat/completions`（小 prompt，`"reply OK"`）= 200，有 `usage`
- [ ] Chat 流式：以 `data: [DONE]` 结束，正文无重复片段
- [ ] Responses 流式：事件含 `response.created … response.completed`，`sequence_number` 递增
- [ ] Anthropic `POST /v1/messages` 流式与非流式各一次
- [ ] 工具调用往返一次（带 `tools`，回传 tool result 后得到最终文本）
- [ ] `max_tokens` 请求 200 且响应头 `x-gateway-ignored-params`；`response_format: json_schema` 与 `previous_response_id` = 400 `unsupported_parameter`；Anthropic 缺 `max_tokens` = 400
- [ ] ~20MB 协议体 = 413 JSON（默认 `MAX_BODY_BYTES=16777216`；Caddy `request_body max_size 16MB`）
- [ ] 以 `crsr_` 开头的 key 作 Bearer = 401（不可直通）
- [ ] 后台：随机 `DASHBOARD_PATH` 可登录，旧 `/dashboard` 404；key 列表只显示掩码
- [ ] 真实客户端（Grok / Claude Code）各发一次对话
- [ ] `journalctl -u cursor-proxy-api --since "10 min ago" | grep -ci error` 无异常增长

## 5. 回滚（任一冒烟项失败即执行）
```bash
ssh root@$HOST 'set -e; B=<第2步的备份目录>
  systemctl stop cursor-proxy-api
  find /opt/cursor-proxy-api -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} +
  tar -C /opt/cursor-proxy-api -xzf $B/app.tgz
  chown -R cursorgw:cursorgw /opt/cursor-proxy-api
  systemctl start cursor-proxy-api; sleep 3; systemctl is-active cursor-proxy-api'
```
若第 3 步重装过依赖，同时恢复 `node_modules`（回滚前先单独备份它，或 `npm ci --omit=dev` 重装旧 lock）。回滚后重做冒烟第 1-3 项。确认稳定后再删除备份与 `/tmp/cpa-release.tgz`。

## 6. 监控 F10（流式重复片段）
网关逐块透传 SDK 事件，不去重；本地与线上抓取均未复现。上线后可短期观察：
新版日志只含元数据（不再保存对话文本，也没有 `TRACE_REQUESTS` 开关）。因此网关侧无法再肉眼比对输出文本，改用以下方式：
1. 用后台登录 cookie 调 `GET /v1/admin/logs`，看 `outputChars` 与 `metrics.outputTokens` 是否明显不成比例（字符数远大于 token 数可疑）。
2. 命中时由客户端侧抓取原始响应（客户端自己的日志/抓包），据此区分上游重放、网关或客户端渲染；网关不提供对话内容。
3. 排查"串话/复用"：对比详情中的 `fingerprint.conversation / priorPrefix / currentPrefix` 与执行模式（fresh / warm / parked）。

## 已知噪声：`[TranscriptStore] Failed to write transcript: EACCES`
服务用户 `cursorgw` 没有 home 目录且 unit 带 `ProtectHome=yes`，SDK 无法写 `~/.cursor/projects/...` 转录文件。这是尽力而为的写入，不影响请求，但会刷日志。若要消除：在 drop-in 里设 `Environment=HOME=/opt/cursor-proxy-api/home`（该路径在 `ReadWritePaths` 内，需 `mkdir -p` 并 `chown cursorgw`），重启后生效。
