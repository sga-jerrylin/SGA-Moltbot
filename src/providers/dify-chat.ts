/**
 * Dify Chat Provider
 * Implements Dify's Chat API as a model provider for OpenClaw
 *
 * Dify API Reference:
 * - POST /v1/chat-messages - Send chat message
 * - Supports blocking and streaming response modes
 * - Agent mode requires streaming
 */

import type { ModelDefinitionConfig } from "../config/types.models.js";

// Dify Chat Request
export interface DifyChatRequest {
  inputs?: Record<string, unknown>;
  query: string;
  response_mode: "streaming" | "blocking";
  user: string;
  conversation_id?: string;
  files?: Array<{
    type: "image";
    transfer_method: "remote_url" | "local_file";
    url?: string;
    upload_file_id?: string;
  }>;
  auto_generate_name?: boolean;
  trace_id?: string;
}

// Dify Blocking Response
export interface DifyChatBlockingResponse {
  event: "message";
  task_id: string;
  id: string;
  message_id: string;
  conversation_id: string;
  mode: "chat";
  answer: string;
  metadata: {
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
    retriever_resources?: unknown[];
  };
  created_at: number;
}

// Dify Streaming Events
export type DifyStreamEvent =
  | DifyMessageEvent
  | DifyAgentMessageEvent
  | DifyAgentThoughtEvent
  | DifyMessageEndEvent
  | DifyMessageFileEvent
  | DifyErrorEvent
  | DifyPingEvent;

export interface DifyMessageEvent {
  event: "message";
  task_id: string;
  message_id: string;
  conversation_id: string;
  answer: string;
  created_at: number;
}

export interface DifyAgentMessageEvent {
  event: "agent_message";
  task_id: string;
  message_id: string;
  conversation_id: string;
  answer: string;
  created_at: number;
}

export interface DifyAgentThoughtEvent {
  event: "agent_thought";
  id: string;
  task_id: string;
  message_id: string;
  position: number;
  thought: string;
  observation: string;
  tool: string;
  tool_input: string;
  created_at: number;
  message_files?: string[];
  conversation_id: string;
}

export interface DifyMessageEndEvent {
  event: "message_end";
  task_id: string;
  message_id: string;
  conversation_id: string;
  metadata: {
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
    retriever_resources?: unknown[];
  };
}

export interface DifyMessageFileEvent {
  event: "message_file";
  id: string;
  type: string;
  belongs_to: string;
  url: string;
  conversation_id: string;
}

export interface DifyErrorEvent {
  event: "error";
  task_id?: string;
  message_id?: string;
  status: number;
  code: string;
  message: string;
}

export interface DifyPingEvent {
  event: "ping";
}

// Provider configuration
export interface DifyProviderConfig {
  baseUrl: string;
  apiKey: string;
  // Fixed user ID - if set, all requests will use this user ID
  // This allows user identification to be handled by Dify workflows
  fixedUserId?: string;
  // Default conversation ID for session continuity
  defaultConversationId?: string;
  // Whether this is an Agent/Workflow app (requires streaming)
  isAgent?: boolean;
  // Custom inputs to pass to Dify
  inputs?: Record<string, unknown>;
}

/**
 * Dify Chat Provider class
 */
export class DifyChatProvider {
  private config: DifyProviderConfig;

  constructor(config: DifyProviderConfig) {
    this.config = config;
  }

  /**
   * Send a chat message to Dify (blocking mode)
   */
  async chat(params: {
    message: string;
    userId?: string;
    conversationId?: string;
    inputs?: Record<string, unknown>;
    files?: DifyChatRequest["files"];
  }): Promise<DifyChatBlockingResponse> {
    // Use fixed user ID if configured, otherwise use provided userId
    const effectiveUserId = this.config.fixedUserId || params.userId || "default-user";

    const request: DifyChatRequest = {
      query: params.message,
      response_mode: "blocking",
      user: effectiveUserId,
      conversation_id: params.conversationId || this.config.defaultConversationId || "",
      inputs: { ...this.config.inputs, ...params.inputs },
      files: params.files,
    };

    console.log(`[Dify Provider] Sending blocking request to ${this.config.baseUrl}/chat-messages`);
    console.log(`[Dify Provider] User ID: ${effectiveUserId}`);

    const response = await fetch(`${this.config.baseUrl}/chat-messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Dify Provider] Error response: ${response.status} ${errorText}`);
      throw new Error(`Dify API error: ${response.status} ${errorText}`);
    }

    const result = (await response.json()) as DifyChatBlockingResponse;
    console.log(`[Dify Provider] Received response, conversation_id: ${result.conversation_id}`);
    return result;
  }

  /**
   * Send a chat message to Dify (streaming mode)
   * Returns an async generator that yields stream events
   */
  async *chatStream(params: {
    message: string;
    userId?: string;
    conversationId?: string;
    inputs?: Record<string, unknown>;
    files?: DifyChatRequest["files"];
  }): AsyncGenerator<DifyStreamEvent, void, unknown> {
    // Use fixed user ID if configured, otherwise use provided userId
    const effectiveUserId = this.config.fixedUserId || params.userId || "default-user";

    const request: DifyChatRequest = {
      query: params.message,
      response_mode: "streaming",
      user: effectiveUserId,
      conversation_id: params.conversationId || this.config.defaultConversationId || "",
      inputs: { ...this.config.inputs, ...params.inputs },
      files: params.files,
    };

    console.log(`[Dify Provider] Sending streaming request to ${this.config.baseUrl}/chat-messages`);
    console.log(`[Dify Provider] User ID: ${effectiveUserId}`);

    const response = await fetch(`${this.config.baseUrl}/chat-messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Dify Provider] Error response: ${response.status} ${errorText}`);
      throw new Error(`Dify API error: ${response.status} ${errorText}`);
    }

    if (!response.body) {
      throw new Error("No response body for streaming");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data:")) continue;

          const jsonStr = trimmed.slice(5).trim();
          if (!jsonStr) continue;

          try {
            const event = JSON.parse(jsonStr) as DifyStreamEvent;
            yield event;

            // Log important events
            if (event.event === "message_end") {
              console.log(
                `[Dify Provider] Stream ended, conversation_id: ${event.conversation_id}`
              );
            } else if (event.event === "error") {
              console.error(`[Dify Provider] Stream error: ${event.code} - ${event.message}`);
            }
          } catch {
            // Skip malformed JSON
            console.warn(`[Dify Provider] Failed to parse SSE event: ${jsonStr.slice(0, 100)}`);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Collect full response from streaming (for compatibility)
   */
  async chatStreamCollect(params: {
    message: string;
    userId?: string;
    conversationId?: string;
    inputs?: Record<string, unknown>;
    files?: DifyChatRequest["files"];
  }): Promise<{
    answer: string;
    conversationId: string;
    messageId: string;
    thoughts: DifyAgentThoughtEvent[];
    usage?: DifyMessageEndEvent["metadata"]["usage"];
  }> {
    let answer = "";
    let conversationId = "";
    let messageId = "";
    const thoughts: DifyAgentThoughtEvent[] = [];
    let usage: DifyMessageEndEvent["metadata"]["usage"];

    for await (const event of this.chatStream(params)) {
      switch (event.event) {
        case "message":
        case "agent_message":
          answer += event.answer;
          conversationId = event.conversation_id;
          messageId = event.message_id;
          break;
        case "agent_thought":
          thoughts.push(event);
          conversationId = event.conversation_id;
          messageId = event.message_id;
          break;
        case "message_end":
          conversationId = event.conversation_id;
          messageId = event.message_id;
          usage = event.metadata?.usage;
          break;
        case "error":
          throw new Error(`Dify error: ${event.code} - ${event.message}`);
      }
    }

    return { answer, conversationId, messageId, thoughts, usage };
  }
}

/**
 * Create a Dify provider from OpenClaw config
 */
export function createDifyProvider(params: {
  baseUrl: string;
  apiKey: string;
  fixedUserId?: string;
  isAgent?: boolean;
  inputs?: Record<string, unknown>;
}): DifyChatProvider {
  return new DifyChatProvider({
    baseUrl: params.baseUrl.replace(/\/$/, ""), // Remove trailing slash
    apiKey: params.apiKey,
    fixedUserId: params.fixedUserId,
    isAgent: params.isAgent,
    inputs: params.inputs,
  });
}

/**
 * Build Dify model definition for OpenClaw
 */
export function buildDifyModelDefinition(params?: {
  id?: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
}): ModelDefinitionConfig {
  return {
    id: params?.id || "dify-app",
    name: params?.name || "Dify App",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: params?.contextWindow || 4096,
    maxTokens: params?.maxTokens || 4096,
  };
}
