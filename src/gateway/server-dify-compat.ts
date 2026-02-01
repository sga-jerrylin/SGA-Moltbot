import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ResolvedGatewayAuth } from "./auth.js";
import { readJsonBody } from "./hooks.js";

// Dify-compatible API for sga-cow integration
// Implements: POST /api/dify-compat/v1/chat-messages

// Import SGA types for multi-platform support
import type { SgaPlatform } from "../channels/sga/types.js";

// SGA API Key configuration interface
interface SgaApiConfig {
  apiKey?: string;
  enabled?: boolean;
}

// Generate a random API key (32 bytes = 64 hex chars)
export function generateSgaApiKey(): string {
  return `sga-${randomBytes(32).toString("hex")}`;
}

// Valid SGA platforms
const VALID_PLATFORMS: SgaPlatform[] = ["wechatcom", "feishu", "dingtalk", "wechatmp"];

/**
 * Build session key from user field
 * Supports formats:
 *   - "platform:userId" -> "sga:platform:userId"
 *   - "userId" -> "sga:userId" (legacy)
 */
function buildSessionKey(user: string): string {
  // Check if user contains platform prefix
  const colonIndex = user.indexOf(":");
  if (colonIndex > 0) {
    const potentialPlatform = user.substring(0, colonIndex);
    if (VALID_PLATFORMS.includes(potentialPlatform as SgaPlatform)) {
      // Format: platform:userId -> sga:platform:userId
      return `sga:${user}`;
    }
  }
  // Legacy format: just userId -> sga:userId
  return `sga:${user}`;
}

interface DifyChatRequest {
  inputs?: Record<string, unknown>;
  query: string;
  response_mode?: "streaming" | "blocking";
  conversation_id?: string;
  user: string;
  files?: Array<{
    type: string;
    transfer_method: string;
    url?: string;
    upload_file_id?: string;
  }>;
}

interface DifyChatResponse {
  event: string;
  task_id: string;
  id: string;
  message_id: string;
  conversation_id: string;
  mode: string;
  answer: string;
  metadata: {
    usage: Record<string, number>;
  };
  created_at: number;
}

// Store for pending requests waiting for agent response
const pendingRequests = new Map<
  string,
  {
    resolve: (answer: string) => void;
    reject: (error: Error) => void;
    timeoutId: ReturnType<typeof setTimeout>;
  }
>();

// Called by the agent delivery system to complete a pending request
export function completeDifyRequest(sessionKey: string, answer: string): boolean {
  const pending = pendingRequests.get(sessionKey);
  if (pending) {
    clearTimeout(pending.timeoutId);
    pending.resolve(answer);
    pendingRequests.delete(sessionKey);
    return true;
  }
  return false;
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function sendSseEvent(res: ServerResponse, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// Validate Bearer token from Authorization header
function validateApiKey(req: IncomingMessage, configuredKey: string | undefined): boolean {
  // If no API key configured, allow all requests (open mode)
  if (!configuredKey) {
    return true;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return false;
  }

  // Extract Bearer token
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return false;
  }

  const providedKey = match[1].trim();
  if (!providedKey || providedKey.length !== configuredKey.length) {
    return false;
  }

  // Timing-safe comparison to prevent timing attacks
  try {
    return timingSafeEqual(Buffer.from(providedKey), Buffer.from(configuredKey));
  } catch {
    return false;
  }
}

export async function handleDifyCompatHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    auth: ResolvedGatewayAuth;
    trustedProxies: string[];
  }
): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host || "localhost"}`);

  // Route: POST /api/dify-compat/v1/chat-messages
  if (req.method === "POST" && url.pathname === "/api/dify-compat/v1/chat-messages") {
    return handleChatMessages(req, res, opts);
  }

  // Route: POST /api/dify-compat/v1/files/upload (placeholder)
  if (req.method === "POST" && url.pathname === "/api/dify-compat/v1/files/upload") {
    sendJson(res, 501, { code: "not_implemented", message: "File upload not yet supported" });
    return true;
  }

  // Route: POST /api/dify-compat/v1/chat-messages/:task_id/stop (placeholder)
  if (req.method === "POST" && url.pathname.match(/\/api\/dify-compat\/v1\/chat-messages\/[^/]+\/stop/)) {
    sendJson(res, 200, { result: "success" });
    return true;
  }

  return false;
}

async function handleChatMessages(
  req: IncomingMessage,
  res: ServerResponse,
  _opts: {
    auth: ResolvedGatewayAuth;
    trustedProxies: string[];
  }
): Promise<boolean> {
  // Load config to check API key
  const { loadConfig } = await import("../config/config.js");
  const cfg = loadConfig();
  const sgaConfig = cfg.channels?.["sga"] as SgaApiConfig | undefined;
  const configuredApiKey = sgaConfig?.apiKey;

  // Validate API key if configured
  if (!validateApiKey(req, configuredApiKey)) {
    sendJson(res, 401, {
      code: "unauthorized",
      message: "Invalid or missing API key. Use Authorization: Bearer <your-api-key>",
    });
    return true;
  }

  const bodyResult = await readJsonBody(req, 1024 * 1024);
  if (!bodyResult.ok) {
    sendJson(res, 400, { code: "invalid_request", message: bodyResult.error });
    return true;
  }

  const payload = bodyResult.value as DifyChatRequest;

  // Validate required fields
  if (!payload.query || !payload.user) {
    sendJson(res, 400, { code: "invalid_param", message: "query and user are required" });
    return true;
  }

  const taskId = `task-${randomUUID()}`;
  const messageId = `msg-${randomUUID()}`;
  const conversationId = payload.conversation_id || `conv-${payload.user}-${randomUUID().slice(0, 8)}`;
  const createdAt = Math.floor(Date.now() / 1000);
  const responseMode = payload.response_mode || "blocking";

  // Build session key for routing
  // Support multi-platform format: sga:{platform}:{user_id}
  // The user field from sga-cow can be in format: "platform:userId" or just "userId"
  const sessionKey = buildSessionKey(payload.user);

  // Extract context from inputs
  const inputs = payload.inputs || {};
  const userName = (inputs.user_name as string) || payload.user;
  const roomId = inputs.room_id as string | undefined;
  const roomName = inputs.room_name as string | undefined;

  // Build context prefix for the agent
  let contextPrefix = "";
  if (roomId || roomName) {
    contextPrefix = `[群聊: ${roomName || roomId}] `;
  }
  const fullMessage = `${contextPrefix}${payload.query}`;

  // Import and call the agent dispatcher
  try {
    const { runCronIsolatedAgentTurn } = await import("../cron/isolated-agent.js");
    const { loadConfig } = await import("../config/config.js");
    const { createDefaultDeps } = await import("../cli/deps.js");

    const cfg = loadConfig();
    const deps = createDefaultDeps();

    // Create a cron-style job for the agent
    const now = Date.now();
    const job = {
      id: taskId,
      name: `SGA:${userName}`,
      enabled: true,
      createdAtMs: now,
      updatedAtMs: now,
      schedule: { kind: "at" as const, atMs: now },
      sessionTarget: "isolated" as const,
      wakeMode: "now" as const,
      payload: {
        kind: "agentTurn" as const,
        message: fullMessage,
        deliver: false, // Don't auto-deliver, we return the response directly
        channel: "sga" as const,
        to: payload.user,
      },
      state: { nextRunAtMs: now },
    };

    if (responseMode === "streaming") {
      // SSE streaming response
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      // Send initial ping
      sendSseEvent(res, "ping", {});

      // Run agent and stream response
      const result = await runCronIsolatedAgentTurn({
        cfg,
        deps,
        job,
        message: fullMessage,
        sessionKey,
        lane: "sga",
      });

      const answer = result.outputText || result.summary || "";

      if (result.status === "error") {
        sendSseEvent(res, "error", {
          task_id: taskId,
          message_id: messageId,
          status: 500,
          code: "agent_error",
          message: result.error || "Agent processing failed",
        });
      } else {
        // Send the answer as agent_message events (chunked for streaming effect)
        const chunks = chunkText(answer, 50);
        for (const chunk of chunks) {
          sendSseEvent(res, "agent_message", {
            task_id: taskId,
            message_id: messageId,
            conversation_id: conversationId,
            answer: chunk,
            created_at: createdAt,
          });
        }

        // Send message_end
        sendSseEvent(res, "message_end", {
          task_id: taskId,
          message_id: messageId,
          conversation_id: conversationId,
          metadata: {
            usage: {
              prompt_tokens: 0,
              completion_tokens: answer.length,
              total_tokens: answer.length,
            },
          },
        });
      }

      res.end();
    } else {
      // Blocking response
      const result = await runCronIsolatedAgentTurn({
        cfg,
        deps,
        job,
        message: fullMessage,
        sessionKey,
        lane: "sga",
      });

      const answer = result.outputText || result.summary || "";

      if (result.status === "error") {
        sendJson(res, 500, {
          code: "agent_error",
          message: result.error || "Agent processing failed",
        });
      } else {
        const response: DifyChatResponse = {
          event: "message",
          task_id: taskId,
          id: messageId,
          message_id: messageId,
          conversation_id: conversationId,
          mode: "chat",
          answer,
          metadata: {
            usage: {
              prompt_tokens: 0,
              completion_tokens: answer.length,
              total_tokens: answer.length,
            },
          },
          created_at: createdAt,
        };

        sendJson(res, 200, response);
      }
    }
  } catch (err) {
    console.error("[Dify Compat] Agent execution failed:", err);
    sendJson(res, 500, {
      code: "internal_error",
      message: String(err),
    });
  }

  return true;
}

// Helper to chunk text for streaming effect
function chunkText(text: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks.length > 0 ? chunks : [""];
}
