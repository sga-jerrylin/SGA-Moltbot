// Feishu (飞书) Sender
// API Docs: https://open.feishu.cn/document/server-docs/im-v1/message/create

import { fetch } from "undici";
import type {
  FeishuConfig,
  SgaPlatformSender,
  SgaSendResult,
  SgaListUsersResult,
  SgaListDepartmentsResult,
  SgaUserInfo,
  SgaDepartmentInfo,
  TokenCacheEntry,
} from "../types.js";

const FEISHU_API_BASE = "https://open.feishu.cn/open-apis";

export class FeishuSender implements SgaPlatformSender {
  readonly platform = "feishu" as const;
  private tokenCache: TokenCacheEntry | null = null;

  constructor(private config: FeishuConfig) {}

  isConfigured(): boolean {
    return Boolean(this.config.appId && this.config.appSecret);
  }

  /**
   * Get tenant access token with caching
   */
  private async getAccessToken(): Promise<string> {
    // Check cache (with 5 min buffer)
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 5 * 60 * 1000) {
      return this.tokenCache.token;
    }

    const url = `${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal/`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: this.config.appId,
        app_secret: this.config.appSecret,
      }),
    });

    if (!res.ok) {
      throw new Error(`Feishu get token failed: ${res.status}`);
    }

    const data = (await res.json()) as {
      code?: number;
      msg?: string;
      tenant_access_token?: string;
      expire?: number;
    };

    if (data.code !== 0) {
      throw new Error(`Feishu get token error: ${data.code} ${data.msg}`);
    }

    if (!data.tenant_access_token) {
      throw new Error("Feishu get token: no tenant_access_token in response");
    }

    // Cache token (expire is in seconds)
    this.tokenCache = {
      token: data.tenant_access_token,
      expiresAt: Date.now() + (data.expire || 7200) * 1000,
    };

    return data.tenant_access_token;
  }

  async sendText(targetId: string, content: string): Promise<SgaSendResult> {
    try {
      const accessToken = await this.getAccessToken();

      // Determine receive_id_type based on targetId format
      // open_id starts with "ou_", user_id is plain, chat_id starts with "oc_"
      let receiveIdType = "open_id";
      if (targetId.startsWith("oc_")) {
        receiveIdType = "chat_id";
      } else if (!targetId.startsWith("ou_")) {
        receiveIdType = "user_id";
      }

      const url = `${FEISHU_API_BASE}/im/v1/messages?receive_id_type=${receiveIdType}`;

      const payload = {
        receive_id: targetId,
        msg_type: "text",
        content: JSON.stringify({ text: content }),
      };

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        return {
          success: false,
          error: `HTTP ${res.status}`,
        };
      }

      const data = (await res.json()) as {
        code?: number;
        msg?: string;
        data?: {
          message_id?: string;
        };
      };

      if (data.code !== 0) {
        return {
          success: false,
          error: `${data.code}: ${data.msg}`,
        };
      }

      return {
        success: true,
        messageId: data.data?.message_id,
      };
    } catch (err) {
      return {
        success: false,
        error: String(err),
      };
    }
  }

  async sendMarkdown(targetId: string, content: string): Promise<SgaSendResult> {
    // Feishu uses interactive card for rich content, fallback to text for now
    // TODO: Implement card message for full markdown support
    return this.sendText(targetId, content);
  }

  /**
   * List departments
   * API: https://open.feishu.cn/document/server-docs/contact-v3/department/children
   */
  async listDepartments(): Promise<SgaListDepartmentsResult> {
    try {
      const accessToken = await this.getAccessToken();
      const url = `${FEISHU_API_BASE}/contact/v3/departments?page_size=50`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) {
        return { success: false, error: `HTTP ${res.status}` };
      }

      const data = (await res.json()) as {
        code?: number;
        msg?: string;
        data?: {
          items?: Array<{
            open_department_id: string;
            name: string;
            parent_department_id?: string;
          }>;
        };
      };

      if (data.code !== 0) {
        return { success: false, error: `${data.code}: ${data.msg}` };
      }

      const departments: SgaDepartmentInfo[] = (data.data?.items || []).map((d) => ({
        deptId: d.open_department_id,
        name: d.name,
        parentId: d.parent_department_id,
      }));

      return { success: true, departments };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  /**
   * List users in a department
   * API: https://open.feishu.cn/document/server-docs/contact-v3/user/find_by_department
   */
  async listUsers(deptId?: string): Promise<SgaListUsersResult> {
    try {
      const accessToken = await this.getAccessToken();
      const departmentId = deptId || "0"; // Root department
      const url = `${FEISHU_API_BASE}/contact/v3/users/find_by_department?department_id=${departmentId}&page_size=50`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) {
        return { success: false, error: `HTTP ${res.status}` };
      }

      const data = (await res.json()) as {
        code?: number;
        msg?: string;
        data?: {
          items?: Array<{
            open_id: string;
            user_id?: string;
            name: string;
            email?: string;
            mobile?: string;
            avatar?: { avatar_origin?: string };
          }>;
        };
      };

      if (data.code !== 0) {
        return { success: false, error: `${data.code}: ${data.msg}` };
      }

      const users: SgaUserInfo[] = (data.data?.items || []).map((u) => ({
        userId: u.open_id,
        name: u.name,
        email: u.email,
        mobile: u.mobile,
        avatar: u.avatar?.avatar_origin,
      }));

      return { success: true, users };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }
}
