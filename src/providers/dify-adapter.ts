/**
 * Dify Adapter for OpenClaw Agent Runner
 *
 * This adapter wraps the DifyChatProvider to integrate with OpenClaw's
 * agent execution flow. It handles:
 * - User ID resolution (fixed vs dynamic)
 * - Conversation management
 * - Streaming/blocking mode selection
 * - Agent/Workflow mode detection
 */

import type { OpenClawConfig } from "../config/config.js";
import type { ModelProviderConfig } from "../config/types.models.js";
import {
  DifyChatProvider,
  type DifyAgentThoughtEvent,
  type DifyStreamEvent,
} from "./dify-chat.js";

export interface DifyAdapterConfig {
  baseUrl: string;
  apiKey: string;
  fixedUserId?: string;
  isAgent?: boolean;
  inputs?: Record<string, unknown>;
}

export interface DifyRunParams {
  message: string;
  /** User ID from the incoming request (e.g., sga-cow user field) */
  requestUserId?: string;
  /** Session key for conversation tracking */
  sessionKey?: string;
  /** Existing conversation ID to continue */
  conversationId?: string;
  /** Additional inputs for this request */
  inputs?: Record<string, unknown>;
  /** Callback for streaming text chunks */
  onTextChunk?: (text: string) => void;
  /** Callback for agent thoughts */
  onThought?: (thought: DifyAgentThoughtEvent) => void;
  /** Callback for stream events */
  onEvent?: (event: DifyStreamEvent) => void;
}

export interface DifyRunResult {
  answer: string;
  conversationId: string;
  messageId: string;
  thoughts: DifyAgentThoughtEvent[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

// Conversation ID cache by session key
const conversationCache = new Map<string, string>();

/**
 * Get or create Dify adapter from OpenClaw config
 */
export function getDifyAdapterFromConfig(
  cfg: OpenClawConfig,
  providerId: string = "dify"
): DifyAdapterConfig | null {
  const providerConfig = cfg.models?.providers?.[providerId];
  if (!providerConfig) {
    console.warn(`[Dify Adapter] Provider "${providerId}" not found in config`);
    return null;
  }

  if (providerConfig.api !== "dify-chat") {
    console.warn(`[Dify Adapter] Provider "${providerId}" is not a dify-chat provider`);
    return null;
  }

  if (!providerConfig.apiKey) {
    console.warn(`[Dify Adapter] Provider "${providerId}" has no API key configured`);
    return null;
  }

  return {
    baseUrl: providerConfig.baseUrl,
    apiKey: providerConfig.apiKey,
    fixedUserId: providerConfig.fixedUserId,
    isAgent: providerConfig.isAgent,
    inputs: providerConfig.inputs as Record<string, unknown> | undefined,
  };
}

/**
 * Run a Dify chat request
 */
export async function runDifyChat(
  config: DifyAdapterConfig,
  params: DifyRunParams
): Promise<DifyRunResult> {
  const provider = new DifyChatProvider({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    fixedUserId: config.fixedUserId,
    isAgent: config.isAgent,
    inputs: config.inputs,
  });

  // Resolve user ID: fixed > request > default
  const effectiveUserId = config.fixedUserId || params.requestUserId || "default-user";

  // Resolve conversation ID from cache or params
  let conversationId = params.conversationId;
  if (!conversationId && params.sessionKey) {
    conversationId = conversationCache.get(params.sessionKey);
  }

  console.log(`[Dify Adapter] Running chat:`, {
    userId: effectiveUserId,
    sessionKey: params.sessionKey,
    conversationId: conversationId || "(new)",
    isAgent: config.isAgent,
    messagePreview: params.message.slice(0, 50),
  });

  // Merge inputs
  const mergedInputs = {
    ...config.inputs,
    ...params.inputs,
  };

  // Agent mode requires streaming
  const useStreaming = config.isAgent === true;

  if (useStreaming) {
    // Streaming mode
    let answer = "";
    let resultConversationId = conversationId || "";
    let messageId = "";
    const thoughts: DifyAgentThoughtEvent[] = [];
    let usage: DifyRunResult["usage"];

    for await (const event of provider.chatStream({
      message: params.message,
      userId: effectiveUserId,
      conversationId,
      inputs: mergedInputs,
    })) {
      // Call event callback
      params.onEvent?.(event);

      switch (event.event) {
        case "message":
        case "agent_message":
          answer += event.answer;
          resultConversationId = event.conversation_id;
          messageId = event.message_id;
          params.onTextChunk?.(event.answer);
          break;
        case "agent_thought":
          thoughts.push(event);
          resultConversationId = event.conversation_id;
          messageId = event.message_id;
          params.onThought?.(event);
          break;
        case "message_end":
          resultConversationId = event.conversation_id;
          messageId = event.message_id;
          usage = event.metadata?.usage;
          break;
        case "error":
          throw new Error(`Dify error: ${event.code} - ${event.message}`);
      }
    }

    // Cache conversation ID for session continuity
    if (params.sessionKey && resultConversationId) {
      conversationCache.set(params.sessionKey, resultConversationId);
    }

    return {
      answer,
      conversationId: resultConversationId,
      messageId,
      thoughts,
      usage,
    };
  } else {
    // Blocking mode
    const result = await provider.chat({
      message: params.message,
      userId: effectiveUserId,
      conversationId,
      inputs: mergedInputs,
    });

    // Cache conversation ID for session continuity
    if (params.sessionKey && result.conversation_id) {
      conversationCache.set(params.sessionKey, result.conversation_id);
    }

    return {
      answer: result.answer,
      conversationId: result.conversation_id,
      messageId: result.message_id,
      thoughts: [],
      usage: result.metadata?.usage,
    };
  }
}

/**
 * Clear conversation cache for a session
 */
export function clearDifyConversation(sessionKey: string): boolean {
  return conversationCache.delete(sessionKey);
}

/**
 * Get cached conversation ID for a session
 */
export function getDifyConversationId(sessionKey: string): string | undefined {
  return conversationCache.get(sessionKey);
}
