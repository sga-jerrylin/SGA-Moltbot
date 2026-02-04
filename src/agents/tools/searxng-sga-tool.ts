import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readNumberParam, readStringParam } from "./common.js";
import {
  DEFAULT_TIMEOUT_SECONDS,
  resolveTimeoutSeconds,
  withTimeout,
  readResponseText,
} from "./web-shared.js";

const SearxngSgaSchema = Type.Object({
  query: Type.String({ description: "Search query string." }),
  mode: Type.Optional(
    Type.String({
      description: "Search mode: 'chinese' (default), 'wechat', or 'general'.",
      enum: ["chinese", "wechat", "general"],
    })
  ),
  count: Type.Optional(
    Type.Number({
      description: "Number of results to return (default: 5, max 50).",
      minimum: 1,
      maximum: 50,
    }),
  ),
  sort_by_time: Type.Optional(
    Type.Boolean({
      description: "Sort results by time (newest first). Default is true.",
    })
  ),
  engines: Type.Optional(
    Type.String({
      description: "Comma-separated list of engines (e.g., 'sogou,baidu'). Only for 'chinese' mode.",
    })
  ),
});

type SearxngResult = {
  title: string;
  url: string;
  content?: string;
  publishedDate?: string;
  engine?: string;
};

type SearxngResponse = {
  results: SearxngResult[];
};

function resolveSearxngUrl(config?: OpenClawConfig): string {
  // Use provided URL as default if not in config
  return process.env.SEARXNG_URL || "http://43.139.167.250:8888";
}

async function runSearxngSearch(params: {
  query: string;
  baseUrl: string;
  mode: string;
  count: number;
  sortByTime?: boolean;
  engines?: string;
  timeoutSeconds: number;
}) {
  let endpoint = "/chinese_search";
  if (params.mode === "wechat") endpoint = "/wechat_search";
  else if (params.mode === "general") endpoint = "/search";

  const url = new URL(`${params.baseUrl}${endpoint}`);
  url.searchParams.append("q", params.query);

  if (params.mode === "general") {
    url.searchParams.append("format", "json");
  } else {
    // SGA specific params
    if (params.count) url.searchParams.append("limit", params.count.toString());
    if (params.sortByTime !== undefined) url.searchParams.append("sort_by_time", params.sortByTime.toString());
    if (params.engines && params.mode === "chinese") url.searchParams.append("engines", params.engines);

    // Default enrich params for better context if needed, but keeping it light for now
    url.searchParams.append("expand", "meta");
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    signal: withTimeout(undefined, params.timeoutSeconds * 1000),
  });

  if (!res.ok) {
    const detail = await readResponseText(res);
    throw new Error(`SearXNG API error (${res.status}): ${detail}`);
  }

  const data = (await res.json()) as SearxngResponse;

  return {
    query: params.query,
    mode: params.mode,
    results: data.results?.slice(0, params.count).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
      date: r.publishedDate,
      engine: r.engine
    })) || []
  };
}

export function createSearxngSgaTool(options?: {
  config?: OpenClawConfig;
  sandboxed?: boolean;
}): AnyAgentTool {
  return {
    label: "SearXNG SGA Search",
    name: "searxng_sga_search",
    description: "Search using a private SearXNG-SGA instance. Supports Chinese, WeChat, and General search modes with time sorting.",
    parameters: SearxngSgaSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const query = readStringParam(params, "query", { required: true });
      const mode = readStringParam(params, "mode") || "chinese";
      const count = readNumberParam(params, "count") ?? 5;
      const sortByTime = typeof params["sort_by_time"] === "boolean" ? params["sort_by_time"] : undefined;
      const engines = readStringParam(params, "engines");

      const baseUrl = resolveSearxngUrl(options?.config);

      const result = await runSearxngSearch({
        query,
        baseUrl,
        mode,
        count,
        sortByTime,
        engines,
        timeoutSeconds: resolveTimeoutSeconds(undefined, DEFAULT_TIMEOUT_SECONDS),
      });

      return jsonResult(result);
    },
  };
}
