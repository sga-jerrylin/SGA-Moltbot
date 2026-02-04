import { Type } from "@sinclair/typebox";

import type { OpenClawConfig } from "../../config/config.js";
import { optionalStringEnum, stringEnum } from "../schema/typebox.js";
import { jsonResult, readNumberParam, readStringParam } from "./common.js";
import { callGatewayTool } from "./gateway.js";
import type { AnyAgentTool } from "./common.js";

const SKILLS_ACTIONS = ["status", "bins", "discover", "add", "import", "install", "update"] as const;
const SKILLS_TARGETS = ["workspace", "managed"] as const;
const SKILLS_DISCOVER_MODES = ["auto", "skill-pool", "github"] as const;

// NOTE: Flattened schema (no anyOf/oneOf) for tool-schema compatibility across providers.
const SkillsToolSchema = Type.Object({
  action: stringEnum(SKILLS_ACTIONS),

  // Gateway overrides (optional)
  gatewayUrl: Type.Optional(Type.String()),
  gatewayToken: Type.Optional(Type.String()),
  timeoutMs: Type.Optional(Type.Number()),

  // discover/add
  prompt: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Number()),
  mode: optionalStringEnum(SKILLS_DISCOVER_MODES),
  githubToken: Type.Optional(Type.String()),
  autoInstall: Type.Optional(Type.Boolean()),

  // import
  source: Type.Optional(Type.String()),
  target: optionalStringEnum(SKILLS_TARGETS),
  ref: Type.Optional(Type.String()),
  subdir: Type.Optional(Type.String()),
  overwrite: Type.Optional(Type.Boolean()),

  // install
  name: Type.Optional(Type.String()),
  installId: Type.Optional(Type.String()),

  // update
  skillKey: Type.Optional(Type.String()),
  enabled: Type.Optional(Type.Boolean()),
  apiKey: Type.Optional(Type.String()),
  env: Type.Optional(Type.Record(Type.String(), Type.String())),
});

export function createSkillsTool(_opts?: { config?: OpenClawConfig }): AnyAgentTool {
  return {
    label: "Skills",
    name: "skills",
    description:
      "List, import, and configure OpenClaw skills. Use import to add skills from a git repo or local path, then status/check to confirm they are ready.",
    parameters: SkillsToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      const gatewayUrl = readStringParam(params, "gatewayUrl");
      const gatewayToken = readStringParam(params, "gatewayToken");
      const timeoutMs = readNumberParam(params, "timeoutMs", { integer: true });
      const gatewayOpts = { gatewayUrl, gatewayToken, timeoutMs };

      if (action === "status") {
        const result = await callGatewayTool("skills.status", gatewayOpts, {});
        return jsonResult({ ok: true, result });
      }
      if (action === "bins") {
        const result = await callGatewayTool("skills.bins", gatewayOpts, {});
        return jsonResult({ ok: true, result });
      }
      if (action === "discover") {
        const prompt = readStringParam(params, "prompt", { required: true });
        const limit = readNumberParam(params, "limit", { integer: true });
        const mode = readStringParam(params, "mode");
        const githubToken = readStringParam(params, "githubToken");

        const result = await callGatewayTool("skills.discover", gatewayOpts, {
          prompt,
          ...(typeof limit === "number" ? { limit } : {}),
          ...(mode ? { mode } : {}),
          ...(githubToken ? { githubToken } : {}),
          ...(typeof timeoutMs === "number" ? { timeoutMs } : {}),
        });
        return jsonResult({ ok: true, result });
      }
      if (action === "add") {
        const prompt = readStringParam(params, "prompt", { required: true });
        const targetRaw = readStringParam(params, "target");
        const target = targetRaw === "managed" || targetRaw === "workspace" ? targetRaw : undefined;
        const overwrite = typeof params.overwrite === "boolean" ? params.overwrite : undefined;
        const autoInstall = typeof params.autoInstall === "boolean" ? params.autoInstall : undefined;
        const mode = readStringParam(params, "mode");
        const githubToken = readStringParam(params, "githubToken");

        const result = await callGatewayTool("skills.add", gatewayOpts, {
          prompt,
          ...(target ? { target } : {}),
          ...(typeof overwrite === "boolean" ? { overwrite } : {}),
          ...(typeof autoInstall === "boolean" ? { autoInstall } : {}),
          ...(mode ? { mode } : {}),
          ...(githubToken ? { githubToken } : {}),
          ...(typeof timeoutMs === "number" ? { timeoutMs } : {}),
        });
        return jsonResult({ ok: true, result });
      }
      if (action === "import") {
        const source = readStringParam(params, "source", { required: true });
        const targetRaw = readStringParam(params, "target");
        const target = targetRaw === "managed" || targetRaw === "workspace" ? targetRaw : undefined;
        const ref = readStringParam(params, "ref");
        const subdir = readStringParam(params, "subdir");
        const overwrite = typeof params.overwrite === "boolean" ? params.overwrite : undefined;
        const autoInstall = typeof params.autoInstall === "boolean" ? params.autoInstall : undefined;

        const result = await callGatewayTool("skills.import", gatewayOpts, {
          source,
          ...(target ? { target } : {}),
          ...(ref ? { ref } : {}),
          ...(subdir ? { subdir } : {}),
          ...(typeof overwrite === "boolean" ? { overwrite } : {}),
          ...(typeof autoInstall === "boolean" ? { autoInstall } : {}),
          ...(typeof timeoutMs === "number" ? { timeoutMs } : {}),
        });
        return jsonResult({ ok: true, result });
      }
      if (action === "install") {
        const name = readStringParam(params, "name", { required: true });
        const installId = readStringParam(params, "installId", { required: true });
        const result = await callGatewayTool("skills.install", gatewayOpts, {
          name,
          installId,
          ...(typeof timeoutMs === "number" ? { timeoutMs } : {}),
        });
        return jsonResult({ ok: true, result });
      }
      if (action === "update") {
        const skillKey = readStringParam(params, "skillKey", { required: true });
        const enabled = typeof params.enabled === "boolean" ? params.enabled : undefined;
        const apiKey = typeof params.apiKey === "string" ? params.apiKey : undefined;
        const env = params.env && typeof params.env === "object" ? (params.env as Record<string, string>) : undefined;
        const result = await callGatewayTool("skills.update", gatewayOpts, {
          skillKey,
          ...(typeof enabled === "boolean" ? { enabled } : {}),
          ...(typeof apiKey === "string" ? { apiKey } : {}),
          ...(env ? { env } : {}),
        });
        return jsonResult({ ok: true, result });
      }

      // Should be unreachable due to schema enum.
      return jsonResult({ ok: false, error: `unknown action: ${action}` });
    },
  };
}
