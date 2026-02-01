# SGA 改造项目需求文档 (SGA Modify PRD) v3

## 1. 项目概述
本项目旨在将 OpenClaw 打造为 SGA 生态的核心智能中枢，实现全渠道连接、多模型大脑切换、全场景触发响应以及可扩展的技能生态。核心目标是让 OpenClaw 接管 `sga-cow` 的智能处理能力，同时保持 `sga-cow` 作为稳定的多平台连接网关。

## 2. 功能范围 (Scope)

### 2.1 连接层 (Connectivity) - SGA 消息分发系统
*   **SGA-COW 深度集成 (Inbound)**
    *   利用 "Fake Dify API" (`server-dify-compat.ts`) 接收来自 `sga-cow` 的全渠道消息。
    *   统一 Session 管理：确保所有渠道消息汇聚到统一的 Session 上下文中。
*   **多平台主动发送 (Outbound)**
    *   在 OpenClaw 内部实现各主流平台的原生发送能力，不仅仅依赖 HTTP 响应回复。
    *   支持平台：
        *   **企业微信 (WeCom)**: 应用消息 (Agent)、群机器人 (Group Bot)。
        *   **飞书 (Feishu)**: 机器人消息。
        *   **钉钉 (DingTalk)**: Stream 模式/机器人消息。
        *   **微信公众号 (WeChat MP)**: 客服消息/模板消息。
*   **内网穿透与组网**
    *   采用 Tailscale 方案，打通本地 OpenClaw 与云端 `sga-cow`。

### 2.2 模型层 (Model Providers)
*   **Dify 模型适配**: 允许 OpenClaw 将 Dify 上的 Agent/Workflow 作为底层思考引擎。
*   **HiAgent 模型适配**: 接入 HiAgent 平台能力。

### 2.3 触发层 (Triggers)
*   **COW 全渠道消息触发**: 消息即触发。
*   **时间触发**: Cron 定时任务。
*   **邮件触发**: 监控指定邮箱唤醒 Agent。
*   **Webhook 触发**: ERP/OA 系统对接。

### 2.4 技能层 (Skills)
*   **SGA 基础技能**: `sga_send_message` 工具，允许 Agent 主动向特定用户/群组发送消息。
*   **SGA-Skills-Hub 集成**: 动态加载外部技能库。

## 3. 架构设计：SGA 消息分发系统

### 3.1 混合架构图
```
┌─────────────────────────────────────────────────────────────────────────┐
│                         OpenClaw SGA 架构                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────┐     ┌──────────────────────────────────────────────┐  │
│  │  sga-cow    │     │              OpenClaw                        │  │
│  │  (纯转发)   │────▶│  ┌────────────────────────────────────────┐  │  │
│  │             │     │  │  Dify 兼容层 (入口)                     │  │  │
│  │  飞书webhook│     │  │  POST /api/dify-compat/v1/chat-messages │  │  │
│  │  钉钉stream │     │  └──────────────┬─────────────────────────┘  │  │
│  │  企微callback     │                 │                            │  │
│  └─────────────┘     │                 ▼                            │  │
│                      │  ┌────────────────────────────────────────┐  │  │
│                      │  │  Session Manager (记忆管理)            │  │  │
│                      │  │  Key: "sga:{platform}:{user_id}"       │  │  │
│                      │  └──────────────┬─────────────────────────┘  │  │
│                      │                 │                            │  │
│                      │                 ▼                            │  │
│                      │  ┌────────────────────────────────────────┐  │  │
│                      │  │  Agent Core (思考 & 决策)              │  │  │
│                      │  └──────────────┬─────────────────────────┘  │  │
│                      │                 │                            │  │
│                      │                 ▼                            │  │
│                      │  ┌────────────────────────────────────────┐  │  │
│                      │  │  SGA Senders (主动发送能力)            │  │  │
│                      │  │                                        │  │  │
│                      │  │  ┌──────────┐ ┌──────────┐ ┌────────┐ │  │  │
│                      │  │  │ WeCom    │ │ Feishu   │ │ Ding   │ │  │  │
│                      │  │  │ Sender   │ │ Sender   │ │ Sender │ │  │  │
│                      │  │  └────┬─────┘ └────┬─────┘ └───┬────┘ │  │  │
│                      │  └───────┼────────────┼───────────┼──────┘  │  │
│                      └──────────┼────────────┼───────────┼─────────┘  │
│                                 │            │           │            │
│                                 ▼            ▼           ▼            │
│                           各平台官方 API (HTTP/WebSocket)             │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

### 3.2 关键设计点

#### 1. Session Key 策略
为了区分不同平台的用户并保持对话连续性，Session Key 格式定义为：
`sga:{platform}:{context_id}`
*   `platform`: `wechatcom` (企微), `feishu` (飞书), `dingtalk` (钉钉), `wechatmp` (公众号)
*   `context_id`: 用户的 OpenID 或 UserID (在群聊中可能是 GroupID)

#### 2. 配置结构 (Config)
在 `config.yaml` 中扩展 `sga` 节点：
```yaml
channels:
  sga:
    endpoint: "http://cow-host:port" # 用于回传响应 (Reactive)
    apiKey: "sga-secret-key"
    platforms:
      wechatcom: # 企业微信应用
        corpId: "ww..."
        agentId: "1000002"
        secret: "..."
      feishu:    # 飞书
        appId: "cli_..."
        appSecret: "..."
      dingtalk:  # 钉钉
        clientId: "..."
        clientSecret: "..."
```

#### 3. Agent Tool: `sga_send_message`
创建一个通用的 Tool，让 Agent 可以跨平台发送消息：
```typescript
{
  name: "sga_send_message",
  description: "Send a message to a user on a specific platform",
  parameters: {
    platform: "wechatcom" | "feishu" | "dingtalk" | "wechatmp",
    target_id: string, // UserID or GroupID
    content: string,
    msg_type: "text" | "markdown" | "image" // Default: text
  }
}
```

## 4. 实施路线图 (Roadmap)

### 第一阶段：基础架构与连接 (Completed ✅)
*   [x] Dify 兼容服务端接口 (`server-dify-compat.ts`)。
*   [x] **任务 1.1**: 扩展 `server-dify-compat.ts` 支持 `sga:{platform}:{user}` 格式的 Session Key。
*   [x] **任务 1.2**: 定义 `SgaChannelConfig` 接口，支持多平台配置 (Zod Schema + UI Hints + Integration)。

### 第二阶段：平台发送器实现 (Completed ✅)
*   [x] **任务 2.1**: 实现 `WechatComAppSender` (企业微信应用消息)。
    *   API: `https://qyapi.weixin.qq.com/cgi-bin/message/send`
    *   Auth: `gettoken` (缓存 token)
*   [x] **任务 2.2**: 实现 `FeishuSender` (飞书消息)。
    *   API: `https://open.feishu.cn/open-apis/im/v1/messages`
    *   Auth: `tenant_access_token`
*   [x] **任务 2.3**: 实现 `DingTalkSender` (钉钉消息)。
    *   API: `https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2`
    *   Auth: `oauth2/accessToken`
*   [x] **任务 2.4**: 实现 `WechatMpSender` (公众号消息)。
    *   API: 客服接口 `message/custom/send`
    *   Auth: `token` (缓存 access_token)

### 第三阶段：技能与集成 (Completed ✅)
*   [x] **任务 3.1**: 开发 `sga_send_message` Skill。
    *   实现: `src/agents/tools/sga-send-tool.ts`
    *   工具: `sga_send_message`, `sga_list_users`, `sga_list_departments`
*   [x] **任务 3.2**: 完善 `SGA-skills-hub` 集成。
    *   Skill 文档: `skills/sga/SKILL.md`

## 5. 待确认事项
1.  HiAgent 接口文档。
2.  企业微信群机器人 (Webhook) 是否需要作为独立发送渠道支持？(目前优先支持应用消息)
