// SGA Channel Configuration Schema
// Supports multi-platform messaging: WeCom, Feishu, DingTalk, WeChat MP

import { z } from "zod";

/**
 * Enterprise WeChat (WeCom) Application Config
 */
export const WechatComPlatformSchema = z
  .object({
    corpId: z.string().describe("企业微信 Corp ID"),
    agentId: z.string().describe("应用 Agent ID"),
    secret: z.string().describe("应用 Secret"),
  })
  .strict();

/**
 * Feishu (Lark) Config
 */
export const FeishuPlatformSchema = z
  .object({
    appId: z.string().describe("飞书 App ID"),
    appSecret: z.string().describe("飞书 App Secret"),
  })
  .strict();

/**
 * DingTalk Config
 */
export const DingTalkPlatformSchema = z
  .object({
    clientId: z.string().describe("钉钉 Client ID (AppKey)"),
    clientSecret: z.string().describe("钉钉 Client Secret"),
  })
  .strict();

/**
 * WeChat MP (公众号) Config
 */
export const WechatMpPlatformSchema = z
  .object({
    appId: z.string().describe("公众号 App ID"),
    appSecret: z.string().describe("公众号 App Secret"),
  })
  .strict();

/**
 * SGA Platforms Config - multi-platform support
 */
export const SgaPlatformsSchema = z
  .object({
    wechatcom: WechatComPlatformSchema.optional(),
    feishu: FeishuPlatformSchema.optional(),
    dingtalk: DingTalkPlatformSchema.optional(),
    wechatmp: WechatMpPlatformSchema.optional(),
  })
  .strict();

/**
 * Full SGA Channel Config
 */
export const SgaConfigSchema = z
  .object({
    // API key for Dify-compat authentication (sga-cow -> OpenClaw)
    apiKey: z.string().optional().describe("API Key for authenticating sga-cow requests"),
    // Legacy endpoint for backward compatibility
    endpoint: z.string().optional().describe("Legacy sga-cow endpoint for message relay"),
    token: z.string().optional().describe("Legacy sga-cow auth token"),
    // Multi-platform configurations
    platforms: SgaPlatformsSchema.optional(),
  })
  .strict();

export type SgaConfig = z.infer<typeof SgaConfigSchema>;
