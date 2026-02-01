// SGA Sender Manager - Factory and registry for platform senders

import type {
  SgaChannelConfig,
  SgaPlatform,
  SgaPlatformSender,
  SgaSendRequest,
  SgaSendResult,
  SgaListUsersResult,
  SgaListDepartmentsResult,
} from "./types.js";
import { WechatComSender } from "./senders/wechatcom.js";
import { FeishuSender } from "./senders/feishu.js";
import { DingTalkSender } from "./senders/dingtalk.js";
import { WechatMpSender } from "./senders/wechatmp.js";

/**
 * SGA Sender Manager - manages all platform senders
 */
export class SgaSenderManager {
  private senders: Map<SgaPlatform, SgaPlatformSender> = new Map();

  constructor(config: SgaChannelConfig) {
    this.initializeSenders(config);
  }

  private initializeSenders(config: SgaChannelConfig): void {
    const platforms = config.platforms;
    if (!platforms) return;

    // Initialize WeCom sender
    if (platforms.wechatcom) {
      const sender = new WechatComSender(platforms.wechatcom);
      if (sender.isConfigured()) {
        this.senders.set("wechatcom", sender);
      }
    }

    // Initialize Feishu sender
    if (platforms.feishu) {
      const sender = new FeishuSender(platforms.feishu);
      if (sender.isConfigured()) {
        this.senders.set("feishu", sender);
      }
    }

    // Initialize DingTalk sender
    if (platforms.dingtalk) {
      const sender = new DingTalkSender(platforms.dingtalk);
      if (sender.isConfigured()) {
        this.senders.set("dingtalk", sender);
      }
    }

    // Initialize WeChat MP sender
    if (platforms.wechatmp) {
      const sender = new WechatMpSender(platforms.wechatmp);
      if (sender.isConfigured()) {
        this.senders.set("wechatmp", sender);
      }
    }
  }

  /**
   * Get a sender for a specific platform
   */
  getSender(platform: SgaPlatform): SgaPlatformSender | undefined {
    return this.senders.get(platform);
  }

  /**
   * Check if a platform is configured
   */
  hasPlatform(platform: SgaPlatform): boolean {
    return this.senders.has(platform);
  }

  /**
   * Get all configured platforms
   */
  getConfiguredPlatforms(): SgaPlatform[] {
    return Array.from(this.senders.keys());
  }

  /**
   * Send a message to a specific platform
   */
  async send(request: SgaSendRequest): Promise<SgaSendResult> {
    const sender = this.senders.get(request.platform);
    if (!sender) {
      return {
        success: false,
        error: `Platform ${request.platform} is not configured`,
      };
    }

    const msgType = request.msgType || "text";

    switch (msgType) {
      case "markdown":
        if (sender.sendMarkdown) {
          return sender.sendMarkdown(request.targetId, request.content);
        }
        // Fallback to text if markdown not supported
        return sender.sendText(request.targetId, request.content);

      case "image":
        if (sender.sendImage) {
          return sender.sendImage(request.targetId, request.content);
        }
        return {
          success: false,
          error: `Platform ${request.platform} does not support image messages`,
        };

      case "text":
      default:
        return sender.sendText(request.targetId, request.content);
    }
  }

  /**
   * List users from a platform (Enterprise mode)
   */
  async listUsers(platform: SgaPlatform, deptId?: string): Promise<SgaListUsersResult> {
    const sender = this.senders.get(platform);
    if (!sender) {
      return {
        success: false,
        error: `Platform ${platform} is not configured`,
      };
    }

    if (!sender.listUsers) {
      return {
        success: false,
        error: `Platform ${platform} does not support listing users`,
      };
    }

    return sender.listUsers(deptId);
  }

  /**
   * List departments from a platform (Enterprise mode)
   */
  async listDepartments(platform: SgaPlatform): Promise<SgaListDepartmentsResult> {
    const sender = this.senders.get(platform);
    if (!sender) {
      return {
        success: false,
        error: `Platform ${platform} is not configured`,
      };
    }

    if (!sender.listDepartments) {
      return {
        success: false,
        error: `Platform ${platform} does not support listing departments`,
      };
    }

    return sender.listDepartments();
  }
}

// Singleton instance (lazy initialized)
let senderManagerInstance: SgaSenderManager | null = null;

/**
 * Get or create the SGA sender manager instance
 */
export function getSgaSenderManager(config: SgaChannelConfig): SgaSenderManager {
  if (!senderManagerInstance) {
    senderManagerInstance = new SgaSenderManager(config);
  }
  return senderManagerInstance;
}

/**
 * Reset the sender manager (useful for config reload)
 */
export function resetSgaSenderManager(): void {
  senderManagerInstance = null;
}
