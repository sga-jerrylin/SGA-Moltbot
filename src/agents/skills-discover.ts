import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runCommandWithTimeout } from "../process/exec.js";
import { parseFrontmatter } from "./skills/frontmatter.js";
import { serializeByKey } from "./skills/serialize.js";

export type SkillsDiscoverMode = "auto" | "skill-pool" | "github";

export type SkillsDiscoverRequest = {
  prompt: string;
  /** Max candidates to return (default: 5). */
  limit?: number;
  /** Search strategy (default: auto). */
  mode?: SkillsDiscoverMode;
  /** GitHub token for higher rate limits (optional). */
  githubToken?: string;
  /** Network/git timeout (ms). */
  timeoutMs?: number;
};

export type SkillsDiscoverCandidate = {
  /** Importable source string (GitHub tree URL preferred). */
  source: string;
  /** Match score (0..1). */
  score: number;
  /** Where we found it. */
  provider: "skill-pool" | "github";
  /** Human-readable selection reason. */
  reason: string;
  /** Optional metadata for UX/debugging. */
  skillName?: string;
  description?: string;
  repoFullName?: string;
  repoStars?: number;
  repoDefaultBranch?: string;
  subdir?: string;
};

export type SkillsDiscoverResult = {
  ok: boolean;
  message: string;
  candidates: SkillsDiscoverCandidate[];
  warnings: string[];
};

type SkillPoolIndex = {
  skills?: Array<{
    name?: string;
    description?: string;
    url?: string;
    skill_md_url?: string;
    keywords?: string[];
    source?: string;
    category?: string;
  }>;
};

const SKILL_POOL_INDEX_URL =
  "https://raw.githubusercontent.com/AlataChan/skill-pool/main/awesome_claude_skills_index.json";

const DEFAULT_TIMEOUT_MS = 20_000;

const DISCOVERY_IGNORED_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  ".turbo",
  ".venv",
  "venv",
  ".idea",
  ".vscode",
]);

const ENGLISH_STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "to",
  "of",
  "in",
  "for",
  "on",
  "with",
  "at",
  "by",
  "from",
  "and",
  "but",
  "if",
  "or",
  "this",
  "that",
  "use",
  "using",
  "skill",
  "skills",
  "claude",
  "openclaw",
  "bot",
  "assistant",
  "please",
  "need",
  "want",
  "help",
]);

function tokenize(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
    ?.map((t) => t.trim())
    .filter(Boolean);
  return tokens ?? [];
}

function isMostlyAscii(tokens: string[]): boolean {
  const joined = tokens.join("");
  if (!joined) {
    return true;
  }
  let nonAscii = 0;
  for (const ch of joined) {
    if (ch.charCodeAt(0) > 0x7f) {
      nonAscii += 1;
    }
  }
  return nonAscii / joined.length < 0.2;
}

function pickQueryTokens(prompt: string, maxTokens: number): string[] {
  const tokens = tokenize(prompt);
  const asciiMode = isMostlyAscii(tokens);
  const filtered = tokens
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => (asciiMode ? !ENGLISH_STOPWORDS.has(t) : true));
  const unique = Array.from(new Set(filtered));
  unique.sort((a, b) => b.length - a.length);
  return unique.slice(0, Math.max(1, maxTokens));
}

export function scoreSkillMatch(params: {
  prompt: string;
  name?: string;
  description?: string;
  keywords?: string[];
}): number {
  const queryTokens = new Set(pickQueryTokens(params.prompt, 24));
  if (queryTokens.size === 0) {
    return 0;
  }

  const nameTokens = new Set(tokenize((params.name ?? "").replaceAll("-", " ")));
  const descTokens = new Set(tokenize(params.description ?? ""));
  const keywordTokens = new Set((params.keywords ?? []).flatMap((k) => tokenize(k)));

  const overlap = (a: Set<string>, b: Set<string>) => {
    let c = 0;
    for (const t of a) {
      if (b.has(t)) {
        c += 1;
      }
    }
    return c;
  };

  const nameOverlap = overlap(queryTokens, nameTokens);
  const descOverlap = overlap(queryTokens, descTokens);
  const keywordOverlap = overlap(queryTokens, keywordTokens);

  const nameScore = nameOverlap / Math.max(1, nameTokens.size);
  const descScore = descOverlap / Math.max(1, queryTokens.size);
  const keywordScore = keywordOverlap / Math.max(1, queryTokens.size);

  // Weighted sum (normalize to 0..1)
  const raw = nameScore * 1.0 + descScore * 0.7 + keywordScore * 0.5;
  const normalized = Math.min(raw / 2.2, 1);

  // Small bonus for exact-ish match
  const q = Array.from(queryTokens).join(" ");
  const nameNorm = (params.name ?? "").toLowerCase().replaceAll("-", " ").trim();
  if (nameNorm && (q === nameNorm || q.includes(nameNorm))) {
    return Math.min(1, normalized + 0.15);
  }
  return normalized;
}

export function rankSkillPoolIndex(params: {
  prompt: string;
  index: SkillPoolIndex;
  limit: number;
  threshold: number;
}): SkillsDiscoverCandidate[] {
  const entries = Array.isArray(params.index.skills) ? params.index.skills : [];
  const scored: SkillsDiscoverCandidate[] = [];
  for (const entry of entries) {
    const url = typeof entry.url === "string" ? entry.url.trim() : "";
    if (!url) {
      continue;
    }
    const name = typeof entry.name === "string" ? entry.name.trim() : undefined;
    const description =
      typeof entry.description === "string" ? entry.description.trim() : undefined;
    const keywords = Array.isArray(entry.keywords)
      ? entry.keywords.map((k) => String(k ?? "").trim()).filter(Boolean)
      : undefined;
    const score = scoreSkillMatch({ prompt: params.prompt, name, description, keywords });
    if (score < params.threshold) {
      continue;
    }
    scored.push({
      provider: "skill-pool",
      source: url,
      score,
      reason: "Matched AlataChan/skill-pool index",
      skillName: name,
      description,
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(1, params.limit));
}

async function fetchJsonWithTimeout(params: {
  url: string;
  token?: string;
  timeoutMs: number;
}): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1_000, params.timeoutMs));
  try {
    const headers: Record<string, string> = {
      "User-Agent": "openclaw-skill-discovery",
      Accept: "application/vnd.github+json",
    };
    if (params.token?.trim()) {
      headers.Authorization = `Bearer ${params.token.trim()}`;
    }
    const res = await fetch(params.url, { headers, signal: controller.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status} ${res.statusText}: ${text.slice(0, 200)}` };
    }
    const json = (await res.json()) as unknown;
    return { ok: true, value: json };
  } catch (err) {
    return { ok: false, error: String(err) };
  } finally {
    clearTimeout(timeout);
  }
}

type GitHubRepoSearchResponse = {
  items?: Array<{
    full_name?: string;
    html_url?: string;
    clone_url?: string;
    default_branch?: string;
    stargazers_count?: number;
  }>;
};

function buildGitHubRepoSearchQuery(prompt: string): string {
  const tokens = pickQueryTokens(prompt, 6);
  // Strong bias towards repos that document SKILL.md usage.
  return [...tokens, "SKILL.md", "in:readme"].join(" ").trim();
}

async function collectSkillDirs(rootDir: string): Promise<string[]> {
  const found = new Set<string>();

  const walk = async (dir: string, depth: number) => {
    if (depth > 12) {
      return;
    }
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isFile() && entry.name === "SKILL.md") {
        found.add(dir);
        break;
      }
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (DISCOVERY_IGNORED_NAMES.has(entry.name)) {
        continue;
      }
      await walk(path.join(dir, entry.name), depth + 1);
    }
  };

  await walk(rootDir, 0);
  return [...found].toSorted();
}

function buildTreeUrl(params: { fullName: string; branch: string; subdir?: string }): string {
  const base = `https://github.com/${params.fullName}/tree/${params.branch}`;
  const subdir = params.subdir?.trim().replace(/^\/+/, "");
  if (!subdir) {
    return base;
  }
  return `${base}/${subdir}`;
}

async function discoverFromGitHub(params: {
  prompt: string;
  limit: number;
  token?: string;
  timeoutMs: number;
  threshold: number;
}): Promise<{ candidates: SkillsDiscoverCandidate[]; warnings: string[] }> {
  const warnings: string[] = [];
  const query = buildGitHubRepoSearchQuery(params.prompt);
  const url =
    "https://api.github.com/search/repositories?" +
    new URLSearchParams({
      q: query,
      sort: "stars",
      order: "desc",
      per_page: String(Math.max(1, Math.min(10, params.limit))),
    }).toString();

  const res = await fetchJsonWithTimeout({ url, token: params.token, timeoutMs: params.timeoutMs });
  if (!res.ok) {
    warnings.push(`GitHub repo search failed: ${res.error}`);
    return { candidates: [], warnings };
  }

  const data = res.value as GitHubRepoSearchResponse;
  const repos = Array.isArray(data.items) ? data.items : [];
  if (repos.length === 0) {
    return { candidates: [], warnings };
  }

  // Process repos by stars (API already sorted); pick the first repo that contains a good match.
  for (const repo of repos) {
    const fullName = typeof repo.full_name === "string" ? repo.full_name.trim() : "";
    const cloneUrl = typeof repo.clone_url === "string" ? repo.clone_url.trim() : "";
    const branch = typeof repo.default_branch === "string" ? repo.default_branch.trim() : "main";
    const stars = typeof repo.stargazers_count === "number" ? repo.stargazers_count : undefined;
    if (!fullName || !cloneUrl) {
      continue;
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-skill-discover-"));
    const repoDir = path.join(tmpDir, "repo");
    const cleanup = async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    };

    try {
      const clone = await runCommandWithTimeout(
        ["git", "clone", "--depth", "1", "--branch", branch, cloneUrl, repoDir],
        { timeoutMs: params.timeoutMs },
      );
      if (clone.code !== 0) {
        // Fallback: try without specifying the branch (some repos use unusual default branch naming).
        const fallback = await runCommandWithTimeout(["git", "clone", "--depth", "1", cloneUrl, repoDir], {
          timeoutMs: params.timeoutMs,
        });
        if (fallback.code !== 0) {
          warnings.push(
            `git clone failed for ${fullName}: ${fallback.stderr.trim() || fallback.stdout.trim() || `exit ${fallback.code}`}`,
          );
          continue;
        }
      }

      const skillDirs = await collectSkillDirs(repoDir);
      if (skillDirs.length === 0) {
        continue;
      }

      let best: SkillsDiscoverCandidate | null = null;
      for (const dir of skillDirs) {
        const skillPath = path.join(dir, "SKILL.md");
        let content = "";
        try {
          content = await fs.readFile(skillPath, "utf-8");
        } catch {
          continue;
        }

        let name: string | undefined;
        let description: string | undefined;
        try {
          const fm = parseFrontmatter(content);
          if (typeof fm.name === "string" && fm.name.trim()) {
            name = fm.name.trim();
          }
          if (typeof fm.description === "string" && fm.description.trim()) {
            description = fm.description.trim();
          }
        } catch {
          // ignore
        }

        const rel = path.relative(repoDir, dir).replaceAll(path.sep, "/");
        const score = scoreSkillMatch({ prompt: params.prompt, name, description });
        if (score < params.threshold) {
          continue;
        }
        const candidate: SkillsDiscoverCandidate = {
          provider: "github",
          source: buildTreeUrl({ fullName, branch, subdir: rel === "." ? undefined : rel }),
          score,
          reason: "Matched GitHub repo search (sorted by stars)",
          skillName: name,
          description,
          repoFullName: fullName,
          repoStars: stars,
          repoDefaultBranch: branch,
          subdir: rel === "." ? undefined : rel,
        };
        if (!best || candidate.score > best.score) {
          best = candidate;
        }
      }

      if (best) {
        return { candidates: [best], warnings };
      }
    } catch (err) {
      warnings.push(`GitHub discovery failed for ${fullName}: ${String(err)}`);
    } finally {
      await cleanup();
    }
  }

  return { candidates: [], warnings };
}

export async function discoverSkills(params: SkillsDiscoverRequest): Promise<SkillsDiscoverResult> {
  const prompt = params.prompt.trim();
  if (!prompt) {
    return { ok: false, message: "prompt is required", candidates: [], warnings: [] };
  }

  const limit = typeof params.limit === "number" && Number.isFinite(params.limit)
    ? Math.max(1, Math.min(10, Math.floor(params.limit)))
    : 5;
  const mode: SkillsDiscoverMode = params.mode ?? "auto";
  const timeoutMs =
    typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs)
      ? Math.max(1_000, Math.floor(params.timeoutMs))
      : DEFAULT_TIMEOUT_MS;

  // Heuristic thresholds: skill-pool is curated (lower threshold OK); GitHub scan is expensive (higher threshold).
  const thresholdSkillPool = 0.25;
  const thresholdGitHub = 0.35;

  return await serializeByKey(`skillsDiscover:${mode}:${prompt}`, async () => {
    const warnings: string[] = [];

    if (mode === "auto" || mode === "skill-pool") {
      const idx = await fetchJsonWithTimeout({
        url: SKILL_POOL_INDEX_URL,
        timeoutMs,
      });
      if (idx.ok) {
        const ranked = rankSkillPoolIndex({
          prompt,
          index: idx.value as SkillPoolIndex,
          limit,
          threshold: thresholdSkillPool,
        });
        if (ranked.length > 0) {
          return {
            ok: true,
            message: `Found ${ranked.length} candidate(s) via skill-pool`,
            candidates: ranked,
            warnings,
          };
        }
      } else {
        warnings.push(`skill-pool index fetch failed: ${idx.error}`);
      }
      if (mode === "skill-pool") {
        return {
          ok: false,
          message: "No candidates found via skill-pool",
          candidates: [],
          warnings,
        };
      }
    }

    if (mode === "auto" || mode === "github") {
      const token = params.githubToken?.trim() || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
      const gh = await discoverFromGitHub({
        prompt,
        limit,
        token,
        timeoutMs,
        threshold: thresholdGitHub,
      });
      warnings.push(...gh.warnings);
      if (gh.candidates.length > 0) {
        return {
          ok: true,
          message: `Found ${gh.candidates.length} candidate(s) via GitHub`,
          candidates: gh.candidates,
          warnings,
        };
      }
      return {
        ok: false,
        message: "No candidates found via GitHub",
        candidates: [],
        warnings,
      };
    }

    return { ok: false, message: `Unknown mode: ${mode}`, candidates: [], warnings };
  });
}

