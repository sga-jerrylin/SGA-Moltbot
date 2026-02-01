// DingTalk (钉钉) Sender
// API Docs: https://open.dingtalk.com/document/orgapp/message-types-and-data-format

import { fetch } from "undici";
import type {
  DingTalkConfig,
  SgaPlatformSender,
  SgaSendResult,
  SgaListUsersResult,
  SgaListDepartmentsResult,
  SgaUserInfo,
  SgaDepartmentInfo,
  TokenCacheEntry,
} from "../types.js";

const DINGTALK_API_BASE = "https://api.dingtalk.com";
const DINGTALK_OAPI_BASE = "https://oapi.dingtalk.com";

export class DingTalkSender implements SgaPlatformSender {
  readonly platform = "dingtalk" as const;
  private tokenCache: TokenCacheEntry | null = null;

  constructor(private config: DingTalkConfig) {}

  isConfigured(): boolean {
    return Boolean(this.config.clientId && this.config.clientSecret);
  }

  /**
   * Get access token with caching
   */
  private async getAccessToken(): Promise<string> {
    // Check cache (with 5 min buffer)
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 5 * 60 * 1000) {
      return this.tokenCache.token;
    }

    const url = `${DINGTALK_API_BASE}/v1.0/oauth2/accessToken`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appKey: this.config.clientId,
        appSecret: this.config.clientSecret,
      }),
    });

    if (!res.ok) {
      throw new Error(`DingTalk get token failed: ${res.status}`);
    }

    const data = (await res.json()) as {
      accessToken?: string;
      expireIn?: number;
      errcode?: number;
      errmsg?: string;
    };

    if (!data.accessToken) {
      throw new Error(`DingTalk get token error: ${data.errcode} ${data.errmsg}`);
    }

    // Cache token (expireIn is in seconds)
    this.tokenCache = {
      token: data.accessToken,
      expiresAt: Date.now() + (data.expireIn || 7200) * 1000,
    };

    return data.accessToken;
  }

  async sendText(targetId: string, content: string): Promise<SgaSendResult> {
    try {
      const accessToken = await this.getAccessToken();

      // Use work message API for sending to users
      const url = `${DINGTALK_OAPI_BASE}/topapi/message/corpconversation/asyncsend_v2?access_token=${accessToken}`;

      const payload = {
        agent_id: this.config.clientId, // In DingTalk, agent_id is often same as appKey for internal apps
        userid_list: targetId,
        msg: {
          msgtype: "text",
          text: {
            content,
          },
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
        task_id?: number;
      };

      if (data.errcode !== 0) {
        return {
          success: false,
          error: `${data.errcode}: ${data.errmsg}`,
        };
      }

      return {
        success: true,
        messageId: data.task_id?.toString(),
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

      const url = `${DINGTALK_OAPI_BASE}/topapi/message/corpconversation/asyncsend_v2?access_token=${accessToken}`;

      const payload = {
        agent_id: this.config.clientId,
        userid_list: targetId,
        msg: {
          msgtype: "markdown",
          markdown: {
            title: "消息通知",
            text: content,
          },
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
        task_id?: number;
      };

      if (data.errcode !== 0) {
        return {
          success: false,
          error: `${data.errcode}: ${data.errmsg}`,
        };
      }

      return {
        success: true,
        messageId: data.task_id?.toString(),
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
   * API: https://open.dingtalk.com/document/orgapp/obtain-the-department-list-v2
   */
  async listDepartments(): Promise<SgaListDepartmentsResult> {
    try {
      const accessToken = await this.getAccessToken();
      const url = `${DINGTALK_OAPI_BASE}/topapi/v2/department/listsub?access_token=${accessToken}`;

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dept_id: 1 }), // Root department
      });

      if (!res.ok) {
        return { success: false, error: `HTTP ${res.status}` };
      }

      const data = (await res.json()) as {
        errcode?: number;
        errmsg?: string;
        result?: Array<{
          dept_id: number;
          name: string;
          parent_id: number;
        }>;
      };

      if (data.errcode !== 0) {
        return { success: false, error: `${data.errcode}: ${data.errmsg}` };
      }

      const departments: SgaDepartmentInfo[] = (data.result || []).map((d) => ({
        deptId: String(d.dept_id),
        name: d.name,
        parentId: d.parent_id ? String(d.parent_id) : undefined,
      }));

      return { success: true, departments };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  /**
   * List users in a department
   * API: https://open.dingtalk.com/document/orgapp/queries-the-complete-information-of-a-department-user
   */
  async listUsers(deptId?: string): Promise<SgaListUsersResult> {
    try {
      const accessToken = await this.getAccessToken();
      const departmentId = deptId || "1"; // Root department
      const url = `${DINGTALK_OAPI_BASE}/topapi/v2/user/list?access_token=${accessToken}`;

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dept_id: parseInt(departmentId, 10),
          cursor: 0,
          size: 50,
        }),
      });

      if (!res.ok) {
        return { success: false, error: `HTTP ${res.status}` };
      }

      const data = (await res.json()) as {
        errcode?: number;
        errmsg?: string;
        result?: {
          list?: Array<{
            userid: string;
            name: string;
            dept_id_list?: number[];
            email?: string;
            mobile?: string;
            avatar?: string;
          }>;
        };
      };

      if (data.errcode !== 0) {
        return { success: false, error: `${data.errcode}: ${data.errmsg}` };
      }

      const users: SgaUserInfo[] = (data.result?.list || []).map((u) => ({
        userId: u.userid,
        name: u.name,
        department: u.dept_id_list?.join(","),
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
