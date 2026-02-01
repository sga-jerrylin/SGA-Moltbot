// SGA Channel Types - Multi-platform configuration and sender interfaces

/**
 * Supported SGA platforms
 */
export type SgaPlatform = "wechatcom" | "feishu" | "dingtalk" | "wechatmp";

/**
 * Message types supported across platforms
 */
export type SgaMessageType = "text" | "markdown" | "image";

/**
 * Enterprise WeChat (WeCom) Application configuration
 */
export interface WechatComConfig {
  corpId: string;
  agentId: string;
  secret: string;
}

/**
 * Feishu (Lark) configuration
 */
export interface FeishuConfig {
  appId: string;
  appSecret: string;
}

/**
 * DingTalk configuration
 */
export interface DingTalkConfig {
  clientId: string;
  clientSecret: string;
}

/**
 * WeChat MP (公众号) configuration
 */
export interface WechatMpConfig {
  appId: string;
  appSecret: string;
}

/**
 * Multi-platform configuration
 */
export interface SgaPlatformConfigs {
  wechatcom?: WechatComConfig;
  feishu?: FeishuConfig;
  dingtalk?: DingTalkConfig;
  wechatmp?: WechatMpConfig;
}

/**
 * SGA reply mode
 * - "single": Only reply to a single fixed user (requires defaultUserId)
 * - "enterprise": Can send to any user from contacts list
 */
export type SgaReplyMode = "single" | "enterprise";

/**
 * Full SGA channel configuration
 */
export interface SgaChannelConfig {
  // Legacy endpoint for backward compatibility (回传响应)
  endpoint?: string;
  token?: string;
  // API key for Dify-compat authentication
  apiKey?: string;
  // Reply mode: single user or enterprise (contacts)
  replyMode?: SgaReplyMode;
  // Default user ID for single mode
  defaultUserId?: string;
  // Multi-platform sender configurations
  platforms?: SgaPlatformConfigs;
}

/**
 * Send message request
 */
export interface SgaSendRequest {
  platform: SgaPlatform;
  targetId: string;
  content: string;
  msgType?: SgaMessageType;
  // Optional: for group messages, specify user to @
  atUserId?: string;
}

/**
 * Send message result
 */
export interface SgaSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * User info from platform
 */
export interface SgaUserInfo {
  userId: string;
  name: string;
  department?: string;
  avatar?: string;
  email?: string;
  mobile?: string;
}

/**
 * Department info from platform
 */
export interface SgaDepartmentInfo {
  deptId: string;
  name: string;
  parentId?: string;
}

/**
 * List users result
 */
export interface SgaListUsersResult {
  success: boolean;
  users?: SgaUserInfo[];
  error?: string;
}

/**
 * List departments result
 */
export interface SgaListDepartmentsResult {
  success: boolean;
  departments?: SgaDepartmentInfo[];
  error?: string;
}

/**
 * Platform sender interface - all senders must implement this
 */
export interface SgaPlatformSender {
  readonly platform: SgaPlatform;

  /**
   * Check if the sender is properly configured
   */
  isConfigured(): boolean;

  /**
   * Send a text message
   */
  sendText(targetId: string, content: string): Promise<SgaSendResult>;

  /**
   * Send a markdown message (if supported by platform)
   */
  sendMarkdown?(targetId: string, content: string): Promise<SgaSendResult>;

  /**
   * Send an image by URL
   */
  sendImage?(targetId: string, imageUrl: string): Promise<SgaSendResult>;

  /**
   * List users that the agent can send messages to (Enterprise mode)
   */
  listUsers?(deptId?: string): Promise<SgaListUsersResult>;

  /**
   * List departments (Enterprise mode)
   */
  listDepartments?(): Promise<SgaListDepartmentsResult>;
}

/**
 * Token cache entry
 */
export interface TokenCacheEntry {
  token: string;
  expiresAt: number; // Unix timestamp in milliseconds
}

/**
 * Parse session key to extract platform and user info
 * Format: sga:{platform}:{user_id}
 */
export function parseSessionKey(sessionKey: string): {
  platform: SgaPlatform | null;
  userId: string;
} {
  const parts = sessionKey.split(":");
  if (parts.length >= 3 && parts[0] === "sga") {
    const platform = parts[1] as SgaPlatform;
    const userId = parts.slice(2).join(":"); // Handle user IDs with colons
    if (["wechatcom", "feishu", "dingtalk", "wechatmp"].includes(platform)) {
      return { platform, userId };
    }
  }
  // Fallback: treat entire key as user ID with unknown platform
  return { platform: null, userId: sessionKey.replace(/^sga:/, "") };
}

/**
 * Build session key from platform and user ID
 */
export function buildSessionKey(platform: SgaPlatform, userId: string): string {
  return `sga:${platform}:${userId}`;
}
