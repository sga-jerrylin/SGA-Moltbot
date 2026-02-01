import crypto from "node:crypto";
import type { OpenClawConfig } from "../../../config/config.js";
import { formatDocsLink } from "../../../terminal/links.js";
import type { WizardPrompter } from "../../../wizard/prompts.js";
import type { ChannelOnboardingAdapter } from "../onboarding-types.js";
import type { SgaChannelConfig, SgaPlatform, SgaReplyMode } from "../../sga/types.js";
import {
  getTailscaleBinary,
  getTailnetHostname,
  readTailscaleStatusJson,
} from "../../../infra/tailscale.js";
import { runExec } from "../../../process/exec.js";
import os from "node:os";

const channel = "sga" as const;

type PlatformChoice = {
  value: SgaPlatform;
  label: string;
  hint: string;
};

const PLATFORM_CHOICES: PlatformChoice[] = [
  { value: "wechatcom", label: "企业微信 (WeCom)", hint: "Enterprise WeChat application" },
  { value: "feishu", label: "飞书 (Feishu/Lark)", hint: "Feishu bot application" },
  { value: "dingtalk", label: "钉钉 (DingTalk)", hint: "DingTalk bot application" },
  { value: "wechatmp", label: "微信公众号 (WeChat MP)", hint: "WeChat Official Account" },
];

function generateApiKey(): string {
  return `app-${crypto.randomBytes(32).toString("hex")}`;
}

function getSgaConfig(cfg: OpenClawConfig): SgaChannelConfig | undefined {
  return cfg.channels?.["sga"] as SgaChannelConfig | undefined;
}

type TailscaleStatus = {
  available: boolean;
  hostname?: string;
  serveEnabled?: boolean;
  funnelEnabled?: boolean;
};

async function detectTailscaleStatus(): Promise<TailscaleStatus> {
  try {
    const tailscaleBin = await getTailscaleBinary();
    const statusJson = await readTailscaleStatusJson(runExec);

    // Check if Tailscale is running
    if (!statusJson || Object.keys(statusJson).length === 0) {
      return { available: false };
    }

    // Get hostname
    let hostname: string | undefined;
    try {
      hostname = await getTailnetHostname(runExec, tailscaleBin);
    } catch {
      // Hostname detection failed but Tailscale may still be available
    }

    // Check serve/funnel status
    let serveEnabled = false;
    let funnelEnabled = false;

    try {
      const { stdout } = await runExec(tailscaleBin, ["serve", "status", "--json"], {
        timeoutMs: 5000,
        maxBuffer: 100_000,
      });
      const serveStatus = stdout ? JSON.parse(stdout) : {};
      // If there are any serve configs, it's enabled
      serveEnabled = serveStatus && Object.keys(serveStatus).length > 0;
    } catch {
      // serve status check failed
    }

    try {
      const { stdout } = await runExec(tailscaleBin, ["funnel", "status", "--json"], {
        timeoutMs: 5000,
        maxBuffer: 100_000,
      });
      const funnelStatus = stdout ? JSON.parse(stdout) : {};
      // If there are any funnel configs, it's enabled
      funnelEnabled = funnelStatus && Object.keys(funnelStatus).length > 0;
    } catch {
      // funnel status check failed
    }

    return {
      available: true,
      hostname,
      serveEnabled,
      funnelEnabled,
    };
  } catch {
    return { available: false };
  }
}

/**
 * Install Tailscale based on the current platform
 */
async function installTailscale(prompter: WizardPrompter): Promise<boolean> {
  const platform = os.platform();

  try {
    if (platform === "win32") {
      // Windows: use winget
      await prompter.note(
        "正在使用 winget 安装 Tailscale...",
        "安装 Tailscale",
      );
      try {
        await runExec("winget", ["install", "--id", "tailscale.tailscale", "-e", "--accept-source-agreements", "--accept-package-agreements"], {
          timeoutMs: 300_000, // 5 minutes
          maxBuffer: 500_000,
        });
        await prompter.note(
          [
            "Tailscale 安装完成！",
            "",
            "请在系统托盘中找到 Tailscale 图标并登录。",
            "或者在命令行运行: tailscale up",
          ].join("\n"),
          "安装成功",
        );
        return true;
      } catch {
        await prompter.note(
          [
            "winget 安装失败，请手动下载安装：",
            "https://tailscale.com/download/windows",
          ].join("\n"),
          "安装失败",
        );
        return false;
      }
    } else if (platform === "darwin") {
      // macOS: use brew
      await prompter.note(
        "正在使用 Homebrew 安装 Tailscale...",
        "安装 Tailscale",
      );
      try {
        await runExec("brew", ["install", "tailscale"], {
          timeoutMs: 300_000,
          maxBuffer: 500_000,
        });
        await prompter.note(
          [
            "Tailscale 安装完成！",
            "",
            "请运行以下命令登录：",
            "  tailscale up",
          ].join("\n"),
          "安装成功",
        );
        return true;
      } catch {
        await prompter.note(
          [
            "Homebrew 安装失败，请手动下载安装：",
            "https://tailscale.com/download/mac",
            "",
            "或者先安装 Homebrew：",
            "  /bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"",
          ].join("\n"),
          "安装失败",
        );
        return false;
      }
    } else {
      // Linux: use official install script
      await prompter.note(
        "正在使用官方脚本安装 Tailscale...",
        "安装 Tailscale",
      );
      try {
        await runExec("sh", ["-c", "curl -fsSL https://tailscale.com/install.sh | sh"], {
          timeoutMs: 300_000,
          maxBuffer: 500_000,
        });
        await prompter.note(
          [
            "Tailscale 安装完成！",
            "",
            "请运行以下命令登录：",
            "  sudo tailscale up",
          ].join("\n"),
          "安装成功",
        );
        return true;
      } catch {
        await prompter.note(
          [
            "自动安装失败，请手动安装：",
            "  curl -fsSL https://tailscale.com/install.sh | sh",
            "",
            "或访问：https://tailscale.com/download/linux",
          ].join("\n"),
          "安装失败",
        );
        return false;
      }
    }
  } catch {
    return false;
  }
}

async function noteSgaHelp(prompter: WizardPrompter): Promise<void> {
  await prompter.note(
    [
      "SGA 是一个多平台消息网关，支持企业微信、飞书、钉钉等平台。",
      "",
      "配置流程：",
      "1) 选择要启用的平台并输入对应的凭证",
      "2) 获取 OpenClaw 的 Dify 兼容 API 地址和密钥",
      "3) 将 API 信息配置到 sga-cow 中",
      "",
      `Docs: ${formatDocsLink("/channels/sga")}`,
    ].join("\n"),
    "SGA Channel Setup",
  );
}

async function promptWechatComConfig(prompter: WizardPrompter): Promise<{
  corpId: string;
  agentId: string;
  secret: string;
} | null> {
  await prompter.note(
    [
      "企业微信应用配置：",
      "1) 登录企业微信管理后台: https://work.weixin.qq.com",
      "2) 进入「应用管理」→「自建应用」",
      "3) 获取 Corp ID (在「我的企业」页面)",
      "4) 获取 Agent ID 和 Secret (在应用详情页)",
    ].join("\n"),
    "企业微信 (WeCom)",
  );

  const corpId = String(
    await prompter.text({
      message: "Corp ID (企业ID)",
      placeholder: "ww...",
      validate: (v) => (v?.trim() ? undefined : "Required"),
    }),
  ).trim();

  const agentId = String(
    await prompter.text({
      message: "Agent ID (应用ID)",
      placeholder: "1000002",
      validate: (v) => (v?.trim() ? undefined : "Required"),
    }),
  ).trim();

  const secret = String(
    await prompter.text({
      message: "Secret (应用密钥)",
      validate: (v) => (v?.trim() ? undefined : "Required"),
    }),
  ).trim();

  return { corpId, agentId, secret };
}

async function promptFeishuConfig(prompter: WizardPrompter): Promise<{
  appId: string;
  appSecret: string;
} | null> {
  await prompter.note(
    [
      "飞书应用配置：",
      "1) 登录飞书开放平台: https://open.feishu.cn",
      "2) 创建或选择一个应用",
      "3) 在「凭证与基础信息」页面获取 App ID 和 App Secret",
    ].join("\n"),
    "飞书 (Feishu)",
  );

  const appId = String(
    await prompter.text({
      message: "App ID",
      placeholder: "cli_...",
      validate: (v) => (v?.trim() ? undefined : "Required"),
    }),
  ).trim();

  const appSecret = String(
    await prompter.text({
      message: "App Secret",
      validate: (v) => (v?.trim() ? undefined : "Required"),
    }),
  ).trim();

  return { appId, appSecret };
}

async function promptDingTalkConfig(prompter: WizardPrompter): Promise<{
  clientId: string;
  clientSecret: string;
} | null> {
  await prompter.note(
    [
      "钉钉应用配置：",
      "1) 登录钉钉开放平台: https://open.dingtalk.com",
      "2) 创建或选择一个企业内部应用",
      "3) 在应用信息页面获取 Client ID (AppKey) 和 Client Secret",
    ].join("\n"),
    "钉钉 (DingTalk)",
  );

  const clientId = String(
    await prompter.text({
      message: "Client ID (AppKey)",
      validate: (v) => (v?.trim() ? undefined : "Required"),
    }),
  ).trim();

  const clientSecret = String(
    await prompter.text({
      message: "Client Secret",
      validate: (v) => (v?.trim() ? undefined : "Required"),
    }),
  ).trim();

  return { clientId, clientSecret };
}

async function promptWechatMpConfig(prompter: WizardPrompter): Promise<{
  appId: string;
  appSecret: string;
} | null> {
  await prompter.note(
    [
      "微信公众号配置：",
      "1) 登录微信公众平台: https://mp.weixin.qq.com",
      "2) 在「开发」→「基本配置」页面获取 AppID 和 AppSecret",
    ].join("\n"),
    "微信公众号 (WeChat MP)",
  );

  const appId = String(
    await prompter.text({
      message: "App ID",
      validate: (v) => (v?.trim() ? undefined : "Required"),
    }),
  ).trim();

  const appSecret = String(
    await prompter.text({
      message: "App Secret",
      validate: (v) => (v?.trim() ? undefined : "Required"),
    }),
  ).trim();

  return { appId, appSecret };
}

export const sgaOnboardingAdapter: ChannelOnboardingAdapter = {
  channel,
  getStatus: async ({ cfg }) => {
    const sgaConfig = getSgaConfig(cfg);
    const hasApiKey = Boolean(sgaConfig?.apiKey?.trim());
    const hasPlatforms = Boolean(
      sgaConfig?.platforms &&
        Object.values(sgaConfig.platforms).some((p) => p && Object.keys(p).length > 0),
    );
    const configured = hasApiKey || hasPlatforms;

    const platformCount = sgaConfig?.platforms
      ? Object.values(sgaConfig.platforms).filter((p) => p && Object.keys(p).length > 0).length
      : 0;

    return {
      channel,
      configured,
      statusLines: [
        `SGA: ${configured ? `configured (${platformCount} platform${platformCount !== 1 ? "s" : ""})` : "needs setup"}`,
      ],
      selectionHint: configured ? "configured" : "WeCom/Feishu/DingTalk integration",
      quickstartScore: configured ? 1 : 5,
    };
  },
  configure: async ({ cfg, prompter }) => {
    await noteSgaHelp(prompter);

    // Step 1: Select platforms to configure
    const platformOptions = PLATFORM_CHOICES.map((p) => ({
      value: p.value,
      label: p.label,
      hint: p.hint,
    }));

    const selectedPlatforms: SgaPlatform[] = [];
    for (const opt of platformOptions) {
      const enable = await prompter.confirm({
        message: `启用 ${opt.label}?`,
        initialValue: false,
      });
      if (enable) {
        selectedPlatforms.push(opt.value);
      }
    }

    if (selectedPlatforms.length === 0) {
      await prompter.note(
        "未选择任何平台。您可以稍后在 config.yaml 中手动配置。",
        "SGA",
      );
    }

    // Step 2: Configure each selected platform
    let next = cfg;
    const existingSgaConfig = getSgaConfig(cfg);
    const platforms: Record<string, unknown> = { ...existingSgaConfig?.platforms };

    for (const platform of selectedPlatforms) {
      switch (platform) {
        case "wechatcom": {
          const config = await promptWechatComConfig(prompter);
          if (config) {
            platforms.wechatcom = config;
          }
          break;
        }
        case "feishu": {
          const config = await promptFeishuConfig(prompter);
          if (config) {
            platforms.feishu = config;
          }
          break;
        }
        case "dingtalk": {
          const config = await promptDingTalkConfig(prompter);
          if (config) {
            platforms.dingtalk = config;
          }
          break;
        }
        case "wechatmp": {
          const config = await promptWechatMpConfig(prompter);
          if (config) {
            platforms.wechatmp = config;
          }
          break;
        }
      }
    }

    // Step 2.5: Select reply mode
    const existingReplyMode = existingSgaConfig?.replyMode;
    const existingDefaultUserId = existingSgaConfig?.defaultUserId?.trim();

    await prompter.note(
      [
        "回复模式选择：",
        "",
        "• 单用户模式：Claw 只会回复一个固定的用户",
        "  适用于个人助理场景，需要指定用户 ID",
        "",
        "• 企业模式：Claw 可以拉取通讯录，向任意用户发送消息",
        "  适用于需要主动触达多人的场景",
      ].join("\n"),
      "回复模式",
    );

    const useSingleMode = await prompter.confirm({
      message: "使用单用户模式？（否则使用企业模式）",
      initialValue: existingReplyMode === "single" || !existingReplyMode,
    });

    const replyMode: SgaReplyMode = useSingleMode ? "single" : "enterprise";
    let defaultUserId: string | undefined;

    if (useSingleMode) {
      const userIdInput = await prompter.text({
        message: "输入默认用户 ID（接收消息的用户）",
        placeholder: "例如: ZhangSan 或 ou_xxx",
        initialValue: existingDefaultUserId ?? "",
        validate: (v) => (v?.trim() ? undefined : "单用户模式需要指定用户 ID"),
      });
      defaultUserId = String(userIdInput).trim();
    } else {
      await prompter.note(
        "企业模式下，Claw 将可以通过 API 拉取通讯录并选择发送对象。",
        "企业模式",
      );
    }

    // Step 3: Generate or use existing API key for Dify-compat
    const existingApiKey = existingSgaConfig?.apiKey?.trim();
    let apiKey = existingApiKey;

    if (existingApiKey) {
      const keepKey = await prompter.confirm({
        message: `已有 API Key: ${existingApiKey.slice(0, 8)}...，保留吗？`,
        initialValue: true,
      });
      if (!keepKey) {
        apiKey = generateApiKey();
      }
    } else {
      apiKey = generateApiKey();
    }

    // Step 4: Detect Tailscale status and show connection info
    const gatewayPort = cfg.gateway?.port ?? 4141;
    let tailscaleStatus = await detectTailscaleStatus();

    // If Tailscale not available, offer to install
    if (!tailscaleStatus.available) {
      const shouldInstall = await prompter.confirm({
        message: "未检测到 Tailscale，是否自动安装？",
        initialValue: true,
      });

      if (shouldInstall) {
        const installed = await installTailscale(prompter);
        if (installed) {
          // Re-detect after installation
          await prompter.note(
            "请先完成 Tailscale 登录 (tailscale up)，然后按回车继续...",
            "等待登录",
          );
          tailscaleStatus = await detectTailscaleStatus();
        }
      }
    }

    let baseUrl: string;
    let connectionNotes: string[] = [];

    if (tailscaleStatus.available && tailscaleStatus.hostname) {
      // Tailscale is available with a hostname
      if (tailscaleStatus.serveEnabled || tailscaleStatus.funnelEnabled) {
        // Tailscale serve/funnel is enabled - use HTTPS on port 443
        baseUrl = `https://${tailscaleStatus.hostname}`;
        connectionNotes = [
          `Tailscale ${tailscaleStatus.funnelEnabled ? "Funnel" : "Serve"} 已启用`,
          `使用 MagicDNS 地址: ${tailscaleStatus.hostname}`,
        ];
      } else {
        // Tailscale available but serve not enabled - use direct port
        baseUrl = `http://${tailscaleStatus.hostname}:${gatewayPort}`;
        connectionNotes = [
          "Tailscale 已连接，但 Serve/Funnel 未启用",
          "",
          "建议启用 Tailscale Serve 以获得 HTTPS 支持：",
          `  tailscale serve --bg ${gatewayPort}`,
          "",
          "或者启用 Funnel 以从公网访问：",
          `  tailscale funnel --bg ${gatewayPort}`,
        ];
      }
    } else if (tailscaleStatus.available) {
      // Tailscale running but no hostname detected
      const gatewayBind = cfg.gateway?.bind ?? "127.0.0.1";
      const isLan = gatewayBind === "lan" || String(gatewayBind) === "0.0.0.0";
      baseUrl = isLan ? `http://<YOUR_IP>:${gatewayPort}` : `http://127.0.0.1:${gatewayPort}`;
      connectionNotes = [
        "Tailscale 已运行但无法获取主机名",
        "请检查 Tailscale 连接状态: tailscale status",
      ];
    } else {
      // Tailscale not available - fallback to local/LAN
      const gatewayBind = cfg.gateway?.bind ?? "127.0.0.1";
      const isLan = gatewayBind === "lan" || String(gatewayBind) === "0.0.0.0";
      baseUrl = isLan ? `http://<YOUR_IP>:${gatewayPort}` : `http://127.0.0.1:${gatewayPort}`;
      connectionNotes = [
        "未检测到 Tailscale，使用本地/局域网地址",
        "",
        "推荐安装 Tailscale 以实现安全的内网穿透：",
        "  https://tailscale.com/download",
        "",
        "安装后运行: tailscale up",
      ];
    }

    await prompter.note(
      [
        "请将以下信息配置到 sga-cow 的 config.yaml 中：",
        "",
        "```yaml",
        "dify:",
        `  base_url: "${baseUrl}/api/dify-compat/v1"`,
        `  api_key: "${apiKey}"`,
        "```",
        "",
        "完整的 Dify Chat API 地址：",
        `POST ${baseUrl}/api/dify-compat/v1/chat-messages`,
        "",
        "---",
        ...connectionNotes,
      ].join("\n"),
      "sga-cow 配置信息",
    );

    // Apply configuration
    const newSgaConfig: Record<string, unknown> = {
      ...existingSgaConfig,
      enabled: true,
      apiKey,
      replyMode,
      ...(defaultUserId ? { defaultUserId } : {}),
    };
    if (Object.keys(platforms).length > 0) {
      newSgaConfig.platforms = platforms;
    }

    next = {
      ...next,
      channels: {
        ...next.channels,
        sga: newSgaConfig,
      },
    };

    return { cfg: next, accountId: "default" };
  },
  disable: (cfg) => {
    const existingSgaConfig = getSgaConfig(cfg);
    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        sga: { ...existingSgaConfig, enabled: false },
      },
    };
  },
};
