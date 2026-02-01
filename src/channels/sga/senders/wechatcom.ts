// WeCom (企业微信) Application Sender
// API Docs: https://developer.work.weixin.qq.com/document/path/90236

import { fetch } from "undici";
import type {
  SgaPlatformSender,
  SgaSendResult,
  SgaListUsersResult,
  SgaListDepartmentsResult,
  SgaUserInfo,
  SgaDepartmentInfo,
  TokenCacheEntry,
  WechatComConfig,
} from "../types.js";

const WECOM_API_BASE = "https://qyapi.weixin.qq.com/cgi-bin";

export class WechatComSender implements SgaPlatformSender {
  readonly platform = "wechatcom" as const;
  private tokenCache: TokenCacheEntry | null = null;

  constructor(private config: WechatComConfig) {}

  isConfigured(): boolean {
    return Boolean(this.config.corpId && this.config.secret && this.config.agentId);
  }

  /**
   * Get access token with caching
   */
  private async getAccessToken(): Promise<string> {
    // Check cache (with 5 min buffer)
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 5 * 60 * 1000) {
      return this.tokenCache.token;
    }

    const url = `${WECOM_API_BASE}/gettoken?corpid=${encodeURIComponent(this.config.corpId)}&corpsecret=${encodeURIComponent(this.config.secret)}`;

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`WeCom gettoken failed: ${res.status}`);
    }

    const data = (await res.json()) as {
      errcode?: number;
      errmsg?: string;
      access_token?: string;
      expires_in?: number;
    };

    if (data.errcode !== 0 && data.errcode !== undefined) {
      throw new Error(`WeCom gettoken error: ${data.errcode} ${data.errmsg}`);
    }

    if (!data.access_token) {
      throw new Error("WeCom gettoken: no access_token in response");
    }

    // Cache token (expires_in is in seconds)
    this.tokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in || 7200) * 1000,
    };

    return data.access_token;
  }

  async sendText(targetId: string, content: string): Promise<SgaSendResult> {
    try {
      const accessToken = await this.getAccessToken();
      const url = `${WECOM_API_BASE}/message/send?access_token=${accessToken}`;

      const payload = {
        touser: targetId,
        msgtype: "text",
        agentid: parseInt(this.config.agentId, 10),
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
        msgid?: string;
      };

      if (data.errcode !== 0) {
        return {
          success: false,
          error: `${data.errcode}: ${data.errmsg}`,
        };
      }

      return {
        success: true,
        messageId: data.msgid,
      };
    } catch (err) {
      return {
        success: false,
        error: String(err),
      };
    }
  }

  async sendMarkdown(targetId: string, content: string): Promise<SgaSendResult> {
    try {
      const accessToken = await this.getAccessToken();
      const url = `${WECOM_API_BASE}/message/send?access_token=${accessToken}`;

      const payload = {
        touser: targetId,
        msgtype: "markdown",
        agentid: parseInt(this.config.agentId, 10),
        markdown: {
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
        msgid?: string;
      };

      if (data.errcode !== 0) {
        return {
          success: false,
          error: `${data.errcode}: ${data.errmsg}`,
        };
      }

      return {
        success: true,
        messageId: data.msgid,
      };
    } catch (err) {
      return {
        success: false,
        error: String(err),
      };
    }
  }

  /**
   * List departments
   * API: https://developer.work.weixin.qq.com/document/path/90208
   */
  async listDepartments(): Promise<SgaListDepartmentsResult> {
    try {
      const accessToken = await this.getAccessToken();
      const url = `${WECOM_API_BASE}/department/list?access_token=${accessToken}`;

      const res = await fetch(url);
      if (!res.ok) {
        return { success: false, error: `HTTP ${res.status}` };
      }

      const data = (await res.json()) as {
        errcode?: number;
        errmsg?: string;
        department?: Array<{
          id: number;
          name: string;
          parentid: number;
        }>;
      };

      if (data.errcode !== 0) {
        return { success: false, error: `${data.errcode}: ${data.errmsg}` };
      }

      const departments: SgaDepartmentInfo[] = (data.department || []).map((d) => ({
        deptId: String(d.id),
        name: d.name,
        parentId: d.parentid ? String(d.parentid) : undefined,
      }));

      return { success: true, departments };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  /**
   * List users in a department
   * API: https://developer.work.weixin.qq.com/document/path/90201
   * @param deptId Department ID (default "1" for root)
   */
  async listUsers(deptId?: string): Promise<SgaListUsersResult> {
    try {
      const accessToken = await this.getAccessToken();
      const departmentId = deptId || "1"; // Root department
      const url = `${WECOM_API_BASE}/user/list?access_token=${accessToken}&department_id=${departmentId}`;

      const res = await fetch(url);
      if (!res.ok) {
        return { success: false, error: `HTTP ${res.status}` };
      }

      const data = (await res.json()) as {
        errcode?: number;
        errmsg?: string;
        userlist?: Array<{
          userid: string;
          name: string;
          department: number[];
          email?: string;
          mobile?: string;
          avatar?: string;
        }>;
      };

      if (data.errcode !== 0) {
        return { success: false, error: `${data.errcode}: ${data.errmsg}` };
      }

      const users: SgaUserInfo[] = (data.userlist || []).map((u) => ({
        userId: u.userid,
        name: u.name,
        department: u.department?.join(","),
        email: u.email,
        mobile: u.mobile,
        avatar: u.avatar,
      }));

      return { success: true, users };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }
}
