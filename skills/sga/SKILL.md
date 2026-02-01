---
name: sga
description: Interact with the SGA ecosystem (WeCom, Feishu, DingTalk)
metadata:
  openclaw:
    emoji: 🐮
---

# SGA Skill

This skill allows the agent to interact with the SGA ecosystem, specifically sending messages to Enterprise WeChat (企业微信), Feishu (飞书), and DingTalk (钉钉).

## Capabilities

The agent can:
- **Receive messages** from SGA platforms (handled transparently via `sga-cow` bridge)
- **Send messages** directly to specific users on any configured platform using the `sga_send_message` tool

## Configuration

Configure `channels.sga` in your `openclaw.yaml` or `openclaw.json`:

```yaml
channels:
  sga:
    # API key for authenticating requests from sga-cow
    apiKey: "sga-your-secret-key"

    # Legacy endpoint for backward compatibility (optional)
    endpoint: "http://localhost:3000"
    token: "your-auth-token"

    # Platform-specific configurations for direct sending
    platforms:
      # Enterprise WeChat (企业微信应用)
      wechatcom:
        corpId: "ww..."
        agentId: "1000002"
        secret: "your-app-secret"

      # Feishu (飞书)
      feishu:
        appId: "cli_..."
        appSecret: "your-app-secret"

      # DingTalk (钉钉)
      dingtalk:
        clientId: "your-client-id"
        clientSecret: "your-client-secret"
```

## Tools

### `sga_send_message`

Send a message to a user on a specific SGA platform.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `platform` | string | Yes | Target platform: `wechatcom`, `feishu`, `dingtalk`, or `wechatmp` |
| `target_id` | string | Yes | User ID or group ID on the platform |
| `content` | string | Yes | Message content |
| `msg_type` | string | No | Message type: `text` (default), `markdown`, or `image` |

**Example:**
```
Send a reminder to user "zhangsan" on WeCom:
- platform: wechatcom
- target_id: zhangsan
- content: "提醒：明天上午10点有会议"
- msg_type: text
```

## Session Key Format

SGA uses a structured session key format to maintain conversation context across platforms:

```
sga:{platform}:{user_id}
```

Examples:
- `sga:wechatcom:zhangsan` - 企业微信用户
- `sga:feishu:ou_xxxxx` - 飞书用户 (Open ID)
- `sga:dingtalk:user123` - 钉钉用户

## Architecture

```
┌─────────────┐     ┌──────────────────────────────────────────┐
│  sga-cow    │     │              OpenClaw                    │
│  (网关)     │────▶│  Dify 兼容层 (入口)                      │
│             │     │  POST /api/dify-compat/v1/chat-messages  │
│  飞书       │     └──────────────┬───────────────────────────┘
│  钉钉       │                    │
│  企微       │                    ▼
└─────────────┘     ┌──────────────────────────────────────────┐
                    │  Agent Core (思考 & 决策)                │
                    └──────────────┬───────────────────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────────────────┐
                    │  SGA Senders (主动发送)                  │
                    │  ┌────────┐ ┌────────┐ ┌────────┐       │
                    │  │ WeCom  │ │ Feishu │ │ Ding   │       │
                    │  │ Sender │ │ Sender │ │ Sender │       │
                    │  └────────┘ └────────┘ └────────┘       │
                    └──────────────────────────────────────────┘
```

## Usage Notes

1. **Passive Response**: When a user sends a message via `sga-cow`, the agent's reply is automatically returned through the same channel.

2. **Proactive Messaging**: Use the `sga_send_message` tool when the agent needs to initiate a conversation or send follow-up messages.

3. **Memory Continuity**: All messages (both inbound and outbound) are recorded in the same session, ensuring the agent has full conversation context.
