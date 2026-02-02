/**
 * Dify Agent Runner
 *
 * Integrates Dify as a model backend for OpenClaw's agent execution.
 * This runner is used when the model provider is configured with api: "dify-chat"
 */

import type { OpenClawConfig } from "../../config/config.js";
import type { ModelProviderConfig } from "../../config/types.models.js";
import {
  DifyChatProvider,
  type DifyAgentThoughtEvent,
  type DifyStreamEvent,
} from "../../providers/dify-chat.js";

export interface DifyAgentRunParams {
  sessionId: string;
  sessionKey: string;
  prompt: string;
  config: OpenClawConfig;
  provider: string;
  model: string;
  /** User ID from the original request (e.g., from sga-cow) */
  requestUserId?: string;
  /** Conversation ID to continue */
  conversationId?: string;
  timeoutMs?: number;
}

export interface DifyAgentRunResult {
  payloads: Array<{ text: string; type?: string }>;
  meta: {
    durationMs: number;
    agentMeta?: {
      sessionId: string;
      provider: string;
      model: string;
      usage?: {
        input?: number;
        output?: number;
        cacheRead?: number;
        cacheWrite?: number;
        total?: number;
      };
    };
  };
  didSendViaMessagingTool?: boolean;
  messagingToolSentTargets?: unknown[];
  /** Dify conversation ID for session continuity */
  difyConversationId?: string;
  /** Agent thoughts from Dify workflow/agent */
  difyThoughts?: DifyAgentThoughtEvent[];
}

// Conversation cache: sessionKey -> conversationId
const conversationCache = new Map<string, string>();

/**
 * Check if a provider is configured as Dify
 */
export function isDifyProvider(provider: string, cfg: OpenClawConfig): boolean {
  const providerConfig = cfg.models?.providers?.[provider];
  return providerConfig?.api === "dify-chat";
}

/**
 * Get Dify provider config
 */
export function getDifyProviderConfig(
  provider: string,
  cfg: OpenClawConfig
): ModelProviderConfig | null {
  const providerConfig = cfg.models?.providers?.[provider];
  if (providerConfig?.api !== "dify-chat") {
    return null;
  }
  return providerConfig;
}

/**
 * Run Dify agent
 */
export async function runDifyAgent(params: DifyAgentRunParams): Promise<DifyAgentRunResult> {
  const providerConfig = getDifyProviderConfig(params.provider, params.config);

  if (!providerConfig) {
    throw new Error(`Provider "${params.provider}" is not configured as dify-chat`);
  }

  if (!providerConfig.apiKey) {
    throw new Error(`Dify provider "${params.provider}" has no API key configured`);
  }

  // Create Dify provider
  const difyProvider = new DifyChatProvider({
    baseUrl: providerConfig.baseUrl,
    apiKey: providerConfig.apiKey,
    fixedUserId: providerConfig.fixedUserId,
    isAgent: providerConfig.isAgent,
    inputs: providerConfig.inputs as Record<string, unknown> | undefined,
  });

  // Resolve user ID: fixedUserId > requestUserId > extract from sessionKey > default
  let effectiveUserId = providerConfig.fixedUserId || params.requestUserId;
  if (!effectiveUserId && params.sessionKey) {
    // Try to extract user ID from session key (format: sga:platform:userId or sga:userId)
    const parts = params.sessionKey.split(":");
    if (parts.length >= 2) {
      effectiveUserId = parts[parts.length - 1]; // Last part is usually userId
    }
  }
  effectiveUserId = effectiveUserId || "default-user";

  // Resolve conversation ID from cache or params
  let conversationId = params.conversationId;
  if (!conversationId && params.sessionKey) {
    conversationId = conversationCache.get(params.sessionKey);
  }

  console.log(`[Dify Runner] Running agent:`, {
    provider: params.provider,
    model: params.model,
    userId: effectiveUserId,
    sessionKey: params.sessionKey,
    conversationId: conversationId || "(new)",
    isAgent: providerConfig.isAgent,
    promptPreview: params.prompt.slice(0, 100),
  });

  const startTime = Date.now();
  const thoughts: DifyAgentThoughtEvent[] = [];
  let answer = "";
  let resultConversationId = conversationId || "";
  let messageId = "";
  let usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } = {};

  try {
    // Agent/Workflow mode requires streaming
    if (providerConfig.isAgent) {
      for await (const event of difyProvider.chatStream({
        message: params.prompt,
        userId: effectiveUserId,
        conversationId,
        inputs: providerConfig.inputs as Record<string, unknown> | undefined,
      })) {
        switch (event.event) {
          case "message":
          case "agent_message":
            answer += event.answer;
            resultConversationId = event.conversation_id;
            messageId = event.message_id;
            break;
          case "agent_thought":
            thoughts.push(event);
            resultConversationId = event.conversation_id;
            messageId = event.message_id;
            break;
          case "message_end":
            resultConversationId = event.conversation_id;
            messageId = event.message_id;
            if (event.metadata?.usage) {
              usage = event.metadata.usage;
            }
            break;
          case "error":
            throw new Error(`Dify error: ${event.code} - ${event.message}`);
        }
      }
    } else {
      // Blocking mode for simple chat
      const result = await difyProvider.chat({
        message: params.prompt,
        userId: effectiveUserId,
        conversationId,
        inputs: providerConfig.inputs as Record<string, unknown> | undefined,
      });

      answer = result.answer;
      resultConversationId = result.conversation_id;
      messageId = result.message_id;
      if (result.metadata?.usage) {
        usage = result.metadata.usage;
      }
    }

    // Cache conversation ID for session continuity
    if (params.sessionKey && resultConversationId) {
      conversationCache.set(params.sessionKey, resultConversationId);
    }

    const duration = Date.now() - startTime;
    console.log(`[Dify Runner] Completed in ${duration}ms:`, {
      conversationId: resultConversationId,
      messageId,
      answerLength: answer.length,
      thoughtsCount: thoughts.length,
    });

    return {
      payloads: [{ text: answer, type: "text" }],
      meta: {
        durationMs: duration,
        agentMeta: {
          sessionId: params.sessionId,
          provider: params.provider,
          model: params.model,
          usage: {
            input: usage.prompt_tokens ?? 0,
            output: usage.completion_tokens ?? 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: usage.total_tokens ?? 0,
          },
        },
      },
      didSendViaMessagingTool: false,
      messagingToolSentTargets: [],
      difyConversationId: resultConversationId,
      difyThoughts: thoughts,
    };
  } catch (error) {
    console.error(`[Dify Runner] Error:`, error);
    throw error;
  }
}

/**
 * Clear cached conversation for a session
 */
export function clearDifyConversation(sessionKey: string): boolean {
  return conversationCache.delete(sessionKey);
}

/**
 * Get cached Dify conversation ID
 */
export function getDifyConversationId(sessionKey: string): string | undefined {
  return conversationCache.get(sessionKey);
}

/**
 * Set Dify conversation ID for a session
 */
export function setDifyConversationId(sessionKey: string, conversationId: string): void {
  conversationCache.set(sessionKey, conversationId);
}
