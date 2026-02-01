import type { OpenClawConfig } from "../../config/config.js";
import type {
  ChannelConfigAdapter,
  ChannelOutboundAdapter,
  ChannelOutboundContext,
  ChannelStatusAdapter,
} from "../plugins/types.adapters.js";
import type { ChannelAccountSnapshot, ChannelCapabilities, ChannelMeta } from "../plugins/types.core.js";
import type { ChannelPlugin } from "../plugins/types.plugin.js";
import { sgaOnboardingAdapter } from "../plugins/onboarding/sga.js";
import { SgaClient } from "./client.js";
import { getSgaSenderManager } from "./sender-manager.js";
import { parseSessionKey } from "./types.js";
import type { SgaChannelConfig } from "./types.js";

interface SgaResolvedAccount {
  accountId: string;
  config: SgaChannelConfig;
}

// 1. Config Adapter
const configAdapter: ChannelConfigAdapter<SgaResolvedAccount> = {
  listAccountIds: (cfg: OpenClawConfig): string[] => {
    const sgaConfig = cfg.channels?.["sga"] as SgaChannelConfig | undefined;
    // Consider configured if has apiKey OR platforms OR legacy endpoint
    if (!sgaConfig?.apiKey && !sgaConfig?.platforms && !sgaConfig?.endpoint) {
      return [];
    }
    return ["default"];
  },
  resolveAccount: (cfg: OpenClawConfig, _accountId?: string | null): SgaResolvedAccount => {
    const sgaConfig = (cfg.channels?.["sga"] as SgaChannelConfig | undefined) ?? {};
    return {
      accountId: "default",
      config: sgaConfig,
    };
  },
  isConfigured: (account: SgaResolvedAccount): boolean => {
    // Configured if has apiKey OR any platform configured OR legacy endpoint
    return Boolean(
      account.config.apiKey ||
        account.config.endpoint ||
        (account.config.platforms &&
          Object.values(account.config.platforms).some((p) => p && Object.keys(p).length > 0)),
    );
  },
  isEnabled: (account: SgaResolvedAccount): boolean => {
    return Boolean(
      account.config.apiKey ||
        account.config.endpoint ||
        (account.config.platforms &&
          Object.values(account.config.platforms).some((p) => p && Object.keys(p).length > 0)),
    );
  },
  describeAccount: (account: SgaResolvedAccount): ChannelAccountSnapshot => {
    const configured = Boolean(
      account.config.apiKey ||
        account.config.endpoint ||
        (account.config.platforms &&
          Object.values(account.config.platforms).some((p) => p && Object.keys(p).length > 0)),
    );
    return {
      accountId: account.accountId,
      name: "SGA Gateway",
      enabled: configured,
      configured,
    };
  },
};

// 2. Status Adapter
const statusAdapter: ChannelStatusAdapter<SgaResolvedAccount> = {
  buildAccountSnapshot: async (params: {
    account: SgaResolvedAccount;
    cfg: OpenClawConfig;
  }): Promise<ChannelAccountSnapshot> => {
    const { account } = params;
    return {
      accountId: account.accountId,
      name: "SGA Gateway",
      enabled: Boolean(account.config.endpoint),
      configured: Boolean(account.config.endpoint),
      linked: Boolean(account.config.endpoint),
    };
  },
};

// 3. Outbound Adapter
const outboundAdapter: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  textChunkLimit: 4000,
  sendText: async (ctx: ChannelOutboundContext) => {
    const sgaConfig = ctx.cfg.channels?.["sga"] as SgaChannelConfig | undefined;
    if (!sgaConfig) {
      throw new Error("SGA channel not configured");
    }

    // Try to parse platform info from the 'to' field
    // Format: platform:userId or just userId (legacy)
    const parsed = parseSessionKey(`sga:${ctx.to}`);

    // If platform is detected and configured, use native sender
    if (parsed.platform && sgaConfig.platforms?.[parsed.platform]) {
      const senderManager = getSgaSenderManager(sgaConfig);
      if (senderManager.hasPlatform(parsed.platform)) {
        const result = await senderManager.send({
          platform: parsed.platform,
          targetId: parsed.userId,
          content: ctx.text,
          msgType: "text",
        });

        if (result.success) {
          return {
            channel: "sga" as const,
            messageId: result.messageId || `sga-${Date.now()}`,
          };
        }
        // If native send failed, fall through to legacy endpoint
        console.warn(`[SGA] Native send to ${parsed.platform} failed: ${result.error}, trying legacy endpoint`);
      }
    }

    // Fallback to legacy endpoint (sga-cow relay)
    if (!sgaConfig.endpoint) {
      throw new Error("SGA channel: no endpoint configured and native send not available");
    }

    const client = new SgaClient({
      endpoint: sgaConfig.endpoint,
      token: sgaConfig.token,
    });

    await client.sendMessage(ctx.to, ctx.text);
    return {
      channel: "sga" as const,
      messageId: `sga-${Date.now()}`,
    };
  },
};

// 4. Channel Metadata
const sgaMeta: ChannelMeta = {
  id: "sga",
  label: "SGA",
  selectionLabel: "SGA (sga-cow)",
  docsPath: "/channels/sga",
  blurb: "Integrates with sga-cow for WeCom/Feishu/DingTalk.",
};

// 5. Channel Capabilities
const sgaCapabilities: ChannelCapabilities = {
  chatTypes: ["direct", "group"],
};

// 6. Export the Channel Plugin
export const sgaChannel: ChannelPlugin<SgaResolvedAccount> = {
  id: "sga",
  meta: sgaMeta,
  capabilities: sgaCapabilities,
  config: configAdapter,
  status: statusAdapter,
  outbound: outboundAdapter,
  onboarding: sgaOnboardingAdapter,
};

export default sgaChannel;
