# SGA 消息分发系统部署指南

本文档说明如何部署 OpenClaw 的 SGA 消息分发系统，实现企业微信、飞书、钉钉、公众号的多平台消息收发。

## 架构概览

```
┌─────────────────┐     ┌─────────────────────────────────┐
│   sga-cow       │     │         OpenClaw Gateway        │
│   (消息网关)    │────▶│   POST /api/dify-compat/v1/...  │
│                 │     │         :18789                  │
│  飞书/钉钉/企微 │     └──────────────┬──────────────────┘
└─────────────────┘                    │
                                       ▼
                       ┌───────────────────────────────────┐
                       │     SGA Senders (主动发送)        │
                       │  ┌────────┐ ┌────────┐ ┌───────┐  │
                       │  │ WeCom  │ │ Feishu │ │ Ding  │  │
                       │  └────────┘ └────────┘ └───────┘  │
                       └───────────────────────────────────┘
```

## 部署步骤

### 1. 克隆代码

```bash
git clone <仓库地址> openclaw
cd openclaw
```

### 2. 准备环境

```bash
# 创建配置目录
mkdir -p ~/.openclaw ~/.openclaw/workspace

# 创建环境变量文件
cat > .env << 'EOF'
OPENCLAW_IMAGE=openclaw:local
OPENCLAW_CONFIG_DIR=~/.openclaw
OPENCLAW_WORKSPACE_DIR=~/.openclaw/workspace
OPENCLAW_GATEWAY_PORT=18789
OPENCLAW_GATEWAY_BIND=lan
OPENCLAW_GATEWAY_TOKEN=<设置一个安全的token>
EOF
```

### 3. 构建 Docker 镜像

```bash
docker build -t openclaw:local .
```

### 4. 启动服务

```bash
docker-compose up -d openclaw-gateway

# 查看日志
docker-compose logs -f openclaw-gateway
```

### 5. 通过 Web UI 配置 SGA

打开浏览器访问：
```
http://<服务器IP>:18789
```

在 **Messaging Channels → SGA (企业微信/飞书/钉钉)** 部分配置：

| 配置项 | 说明 |
|--------|------|
| **SGA API Key** | 用于 sga-cow 认证的密钥 |
| **企业微信 (WeCom)** | Corp ID, Agent ID, Secret |
| **飞书 (Feishu)** | App ID, App Secret |
| **钉钉 (DingTalk)** | Client ID, Client Secret |
| **公众号 (WeChat MP)** | App ID, App Secret |

> 只需配置你使用的平台，其他平台留空即可。

### 6. 配置 sga-cow 连接

在 sga-cow 端配置 OpenClaw 的 Dify 兼容 API 地址：

```yaml
# sga-cow 配置示例
dify:
  endpoint: "http://<OpenClaw服务器IP>:18789/api/dify-compat/v1"
  apiKey: "<你在UI配置的SGA API Key>"
```

## API 接口

### Dify 兼容接口 (Inbound)

**POST** `/api/dify-compat/v1/chat-messages`

```bash
curl -X POST http://localhost:18789/api/dify-compat/v1/chat-messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <SGA_API_KEY>" \
  -d '{
    "query": "你好",
    "user": "feishu:ou_xxxxx",
    "response_mode": "blocking",
    "inputs": {
      "user_name": "张三",
      "room_id": "group123",
      "room_name": "技术群"
    }
  }'
```

**参数说明：**

| 参数 | 必填 | 说明 |
|------|------|------|
| `query` | 是 | 用户消息内容 |
| `user` | 是 | 用户标识，格式: `{platform}:{user_id}` |
| `response_mode` | 否 | `blocking` 或 `streaming`，默认 `blocking` |
| `inputs.user_name` | 否 | 用户名称 |
| `inputs.room_id` | 否 | 群聊 ID（如果是群消息） |
| `inputs.room_name` | 否 | 群聊名称 |

**User 格式示例：**
- `wechatcom:zhangsan` - 企业微信用户
- `feishu:ou_xxxxx` - 飞书用户 (Open ID)
- `dingtalk:user123` - 钉钉用户
- `wechatmp:openid_xxx` - 公众号用户

## Agent 工具

SGA 系统为 Agent 提供以下工具：

### sga_send_message

主动向指定平台用户发送消息。

```json
{
  "platform": "feishu",
  "target_id": "ou_xxxxx",
  "content": "你好，这是一条主动推送的消息",
  "msg_type": "text"
}
```

### sga_list_users

列出平台用户，用于查找目标 ID。

```json
{
  "platform": "wechatcom",
  "dept_id": "1"
}
```

### sga_list_departments

列出部门结构。

```json
{
  "platform": "dingtalk"
}
```

## Session Key 格式

SGA 使用结构化的 Session Key 来维护跨平台的对话上下文：

```
sga:{platform}:{user_id}
```

示例：
- `sga:wechatcom:zhangsan`
- `sga:feishu:ou_xxxxx`
- `sga:dingtalk:user123`

## 故障排查

### 查看日志

```bash
docker-compose logs -f openclaw-gateway
```

### 测试连通性

```bash
# 健康检查
curl http://localhost:18789/health

# 测试 API
curl -X POST http://localhost:18789/api/dify-compat/v1/chat-messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <API_KEY>" \
  -d '{"query": "ping", "user": "test:user1"}'
```

### 常见问题

1. **401 Unauthorized**: 检查 Authorization header 中的 API Key 是否正确
2. **Platform not configured**: 在 UI 中配置对应平台的凭证
3. **Token 过期**: 系统会自动刷新 token，如持续失败请检查平台凭证

## 相关文件

| 文件 | 说明 |
|------|------|
| `src/gateway/server-dify-compat.ts` | Dify 兼容 API 入口 |
| `src/channels/sga/` | SGA 发送器实现 |
| `src/agents/tools/sga-send-tool.ts` | Agent 工具定义 |
| `src/config/zod-schema.sga.ts` | 配置 Schema |
| `skills/sga/SKILL.md` | Skill 文档 |
