// WeChat MP (微信公众号) Sender
// API Docs: https://developers.weixin.qq.com/doc/offiaccount/Message_Management/Service_Center_messages.html

import { fetch } from "undici";
import type {
  WechatMpConfig,
  SgaPlatformSender,
  SgaSendResult,
  TokenCacheEntry,
} from "../types.js";

const WECHAT_API_BASE = "https://api.weixin.qq.com/cgi-bin";

export class WechatMpSender implements SgaPlatformSender {
  readonly platform = "wechatmp" as const;
  private tokenCache: TokenCacheEntry | null = null;

  constructor(private config: WechatMpConfig) {}

  isConfigured(): boolean {
    return Boolean(this.config.appId && this.config.appSecret);
  }

  /**
   * Get access token with caching
   */
  private async getAccessToken(): Promise<string> {
    // Check cache (with 5 min buffer)
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 5 * 60 * 1000) {
      return this.tokenCache.token;
    }

    const url = `${WECHAT_API_BASE}/token?grant_type=client_credential&appid=${encodeURIComponent(this.config.appId)}&secret=${encodeURIComponent(this.config.appSecret)}`;

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`WeChat MP get token failed: ${res.status}`);
    }

    const data = (await res.json()) as {
      errcode?: number;
      errmsg?: string;
      access_token?: string;
      expires_in?: number;
    };

    if (data.errcode) {
      throw new Error(`WeChat MP get token error: ${data.errcode} ${data.errmsg}`);
    }

    if (!data.access_token) {
      throw new Error("WeChat MP get token: no access_token in response");
    }

    // Cache token (expires_in is in seconds)
    this.tokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in || 7200) * 1000,
    };

    return data.access_token;
  }

  /**
   * Send text message via Customer Service API
   * Note: Only works within 48 hours after user interaction
   */
  async sendText(targetId: string, content: string): Promise<SgaSendResult> {
    try {
      const accessToken = await this.getAccessToken();
      const url = `${WECHAT_API_BASE}/message/custom/send?access_token=${accessToken}`;

      const payload = {
        touser: targetId,
        msgtype: "text",
        text: {
          content,
        },
      };

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        return {
          success: false,
          error: `HTTP ${res.status}`,
        };
      }

      const data = (await res.json()) as {
        errcode?: number;
        errmsg?: string;
      };

      if (data.errcode !== 0) {
        // Handle common errors
        if (data.errcode === 45015) {
          return {
            success: false,
            error: "用户超过48小时未互动，无法发送客服消息",
          };
        }
        return {
          success: false,
          error: `${data.errcode}: ${data.errmsg}`,
        };
      }

      return {
        success: true,
      };
    } catch (err) {
      return {
        success: false,
        error: String(err),
      };
    }
  }

  /**
   * Send news (link card) message
   * WeChat MP doesn't support pure markdown, use news for rich content
   */
  async sendMarkdown(targetId: string, content: string): Promise<SgaSendResult> {
    // WeChat MP doesn't support markdown, fallback to text
    return this.sendText(targetId, content);
  }

  /**
   * Send image message
   * Requires uploading image to WeChat first to get media_id
   */
  async sendImage(targetId: string, mediaId: string): Promise<SgaSendResult> {
    try {
      const accessToken = await this.getAccessToken();
      const url = `${WECHAT_API_BASE}/message/custom/send?access_token=${accessToken}`;

      const payload = {
        touser: targetId,
        msgtype: "image",
        image: {
          media_id: mediaId,
        },
      };

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        return {
          success: false,
          error: `HTTP ${res.status}`,
        };
      }

      const data = (await res.json()) as {
        errcode?: number;
        errmsg?: string;
      };

      if (data.errcode !== 0) {
        return {
          success: false,
          error: `${data.errcode}: ${data.errmsg}`,
        };
      }

      return {
        success: true,
      };
    } catch (err) {
      return {
        success: false,
        error: String(err),
      };
    }
  }

  /**
   * Send template message (模板消息)
   * Requires template_id from WeChat MP console
   */
  async sendTemplateMessage(
    targetId: string,
    templateId: string,
    data: Record<string, { value: string; color?: string }>,
    url?: string
  ): Promise<SgaSendResult> {
    try {
      const accessToken = await this.getAccessToken();
      const apiUrl = `${WECHAT_API_BASE}/message/template/send?access_token=${accessToken}`;

      const payload: Record<string, unknown> = {
        touser: targetId,
        template_id: templateId,
        data,
      };

      if (url) {
        payload.url = url;
      }

      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        return {
          success: false,
          error: `HTTP ${res.status}`,
        };
      }

      const result = (await res.json()) as {
        errcode?: number;
        errmsg?: string;
        msgid?: number;
      };

      if (result.errcode !== 0) {
        return {
          success: false,
          error: `${result.errcode}: ${result.errmsg}`,
        };
      }

      return {
        success: true,
        messageId: result.msgid?.toString(),
      };
    } catch (err) {
      return {
        success: false,
        error: String(err),
      };
    }
  }
}
