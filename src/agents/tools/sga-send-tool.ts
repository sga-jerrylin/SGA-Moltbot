// SGA Tools - Send messages and list users on SGA platforms
// This enables the agent to proactively interact with WeCom, Feishu, DingTalk, etc.

import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import { loadConfig } from "../../config/config.js";
import { getSgaSenderManager } from "../../channels/sga/sender-manager.js";
import type { SgaChannelConfig, SgaPlatform, SgaMessageType } from "../../channels/sga/types.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";

const SGA_PLATFORMS = ["wechatcom", "feishu", "dingtalk", "wechatmp"] as const;
const SGA_MESSAGE_TYPES = ["text", "markdown", "image"] as const;

const SgaSendToolSchema = Type.Object({
  platform: Type.Union(SGA_PLATFORMS.map((p) => Type.Literal(p)), {
    description: "Target platform: wechatcom (企业微信), feishu (飞书), dingtalk (钉钉), wechatmp (公众号)",
  }),
  target_id: Type.String({
    description: "Target user ID or group ID on the platform",
  }),
  content: Type.String({
    description: "Message content to send",
  }),
  msg_type: Type.Optional(
    Type.Union(SGA_MESSAGE_TYPES.map((t) => Type.Literal(t)), {
      description: "Message type: text (default), markdown, or image (URL)",
    })
  ),
});

type SgaSendToolOptions = {
  config?: OpenClawConfig;
};

function buildSgaSendToolDescription(cfg?: OpenClawConfig): string {
  const baseDescription = "Send messages to SGA platforms (WeCom, Feishu, DingTalk).";

  if (cfg) {
    const sgaConfig = cfg.channels?.["sga"] as SgaChannelConfig | undefined;
    if (sgaConfig?.platforms) {
      const configuredPlatforms: string[] = [];
      if (sgaConfig.platforms.wechatcom) configuredPlatforms.push("wechatcom (企业微信)");
      if (sgaConfig.platforms.feishu) configuredPlatforms.push("feishu (飞书)");
      if (sgaConfig.platforms.dingtalk) configuredPlatforms.push("dingtalk (钉钉)");
      if (sgaConfig.platforms.wechatmp) configuredPlatforms.push("wechatmp (公众号)");

      if (configuredPlatforms.length > 0) {
        return `${baseDescription} Configured platforms: ${configuredPlatforms.join(", ")}.`;
      }
    }
  }

  return baseDescription;
}

/**
 * Create the SGA send message tool
 */
export function createSgaSendTool(options?: SgaSendToolOptions): AnyAgentTool {
  const description = buildSgaSendToolDescription(options?.config);

  return {
    label: "SGA Send",
    name: "sga_send_message",
    description,
    parameters: SgaSendToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const cfg = options?.config ?? loadConfig();

      // Extract parameters
      const platform = readStringParam(params, "platform", { required: true }) as SgaPlatform;
      const targetId = readStringParam(params, "target_id", { required: true });
      const content = readStringParam(params, "content", { required: true });
      const msgType = (readStringParam(params, "msg_type") || "text") as SgaMessageType;

      if (!targetId) {
        return jsonResult({
          success: false,
          error: "target_id is required",
        });
      }

      if (!content) {
        return jsonResult({
          success: false,
          error: "content is required",
        });
      }

      // Get SGA config
      const sgaConfig = cfg.channels?.["sga"] as SgaChannelConfig | undefined;
      if (!sgaConfig) {
        return jsonResult({
          success: false,
          error: "SGA channel is not configured",
        });
      }

      // Get sender manager
      const senderManager = getSgaSenderManager(sgaConfig);

      // Check if platform is configured
      if (!senderManager.hasPlatform(platform)) {
        const configuredPlatforms = senderManager.getConfiguredPlatforms();
        return jsonResult({
          success: false,
          error: `Platform "${platform}" is not configured. Available platforms: ${configuredPlatforms.join(", ") || "none"}`,
        });
      }

      // Send the message
      const result = await senderManager.send({
        platform,
        targetId,
        content,
        msgType,
      });

      return jsonResult({
        success: result.success,
        messageId: result.messageId,
        error: result.error,
        platform,
        targetId,
      });
    },
  };
}

/**
 * Check if SGA send tool should be enabled
 */
export function isSgaSendToolEnabled(cfg?: OpenClawConfig): boolean {
  const config = cfg ?? loadConfig();
  const sgaConfig = config.channels?.["sga"] as SgaChannelConfig | undefined;

  if (!sgaConfig?.platforms) {
    return false;
  }

  // Check if any platform is configured
  return Boolean(
    sgaConfig.platforms.wechatcom ||
      sgaConfig.platforms.feishu ||
      sgaConfig.platforms.dingtalk ||
      sgaConfig.platforms.wechatmp
  );
}

// ============================================================================
// SGA List Users Tool - Query users that the agent can send messages to
// ============================================================================

const SgaListUsersToolSchema = Type.Object({
  platform: Type.Union(SGA_PLATFORMS.map((p) => Type.Literal(p)), {
    description: "Target platform: wechatcom (企业微信), feishu (飞书), dingtalk (钉钉)",
  }),
  dept_id: Type.Optional(
    Type.String({
      description: "Department ID to filter users (optional, defaults to root department)",
    })
  ),
});

const SgaListDepartmentsToolSchema = Type.Object({
  platform: Type.Union(SGA_PLATFORMS.map((p) => Type.Literal(p)), {
    description: "Target platform: wechatcom (企业微信), feishu (飞书), dingtalk (钉钉)",
  }),
});

/**
 * Create the SGA list users tool
 */
export function createSgaListUsersTool(options?: SgaSendToolOptions): AnyAgentTool {
  return {
    label: "SGA List Users",
    name: "sga_list_users",
    description:
      "List users from an SGA platform that the agent can send messages to. Use this to find user IDs before sending messages.",
    parameters: SgaListUsersToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const cfg = options?.config ?? loadConfig();

      const platform = readStringParam(params, "platform", { required: true }) as SgaPlatform;
      const deptId = readStringParam(params, "dept_id");

      const sgaConfig = cfg.channels?.["sga"] as SgaChannelConfig | undefined;
      if (!sgaConfig) {
        return jsonResult({ success: false, error: "SGA channel is not configured" });
      }

      const senderManager = getSgaSenderManager(sgaConfig);

      if (!senderManager.hasPlatform(platform)) {
        return jsonResult({
          success: false,
          error: `Platform "${platform}" is not configured`,
        });
      }

      const result = await senderManager.listUsers(platform, deptId || undefined);

      return jsonResult({
        success: result.success,
        users: result.users,
        error: result.error,
        platform,
        count: result.users?.length || 0,
      });
    },
  };
}

/**
 * Create the SGA list departments tool
 */
export function createSgaListDepartmentsTool(options?: SgaSendToolOptions): AnyAgentTool {
  return {
    label: "SGA List Departments",
    name: "sga_list_departments",
    description:
      "List departments from an SGA platform. Use this to find department IDs for filtering users.",
    parameters: SgaListDepartmentsToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const cfg = options?.config ?? loadConfig();

      const platform = readStringParam(params, "platform", { required: true }) as SgaPlatform;

      const sgaConfig = cfg.channels?.["sga"] as SgaChannelConfig | undefined;
      if (!sgaConfig) {
        return jsonResult({ success: false, error: "SGA channel is not configured" });
      }

      const senderManager = getSgaSenderManager(sgaConfig);

      if (!senderManager.hasPlatform(platform)) {
        return jsonResult({
          success: false,
          error: `Platform "${platform}" is not configured`,
        });
      }

      const result = await senderManager.listDepartments(platform);

      return jsonResult({
        success: result.success,
        departments: result.departments,
        error: result.error,
        platform,
        count: result.departments?.length || 0,
      });
    },
  };
}
