import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runCommandWithTimeout } from "../process/exec.js";
import { CONFIG_DIR, ensureDir, resolveUserPath } from "../utils.js";
import { parseFrontmatter } from "./skills/frontmatter.js";
import { serializeByKey } from "./skills/serialize.js";

export type SkillsImportTarget = "workspace" | "managed";

export type SkillsImportRequest = {
  /** Git URL / GitHub tree URL / local path to a repo or a skill directory. */
  source: string;
  /** Where to install the imported skills. */
  target: SkillsImportTarget;
  /** Required when target=workspace. */
  workspaceDir?: string;
  /** Override managed skills dir (defaults to ~/.openclaw/skills). */
  managedSkillsDir?: string;
  /** Optional git ref (branch/tag/commit). Only used for git sources. */
  ref?: string;
  /** Optional subdir inside the source to scan for SKILL.md. */
  subdir?: string;
  /** If true, overwrite existing skill directories. */
  overwrite?: boolean;
  /** Git clone timeout. */
  timeoutMs?: number;
};

export type SkillsImportEntry = {
  name?: string;
  sourceDir: string;
  destDir: string;
  skillPath: string;
};

export type SkillsImportSkippedEntry = {
  sourceDir: string;
  reason: "conflict" | "invalid-skill" | "copy-failed";
  message: string;
};

export type SkillsImportResult = {
  ok: boolean;
  message: string;
  targetDir: string;
  imported: SkillsImportEntry[];
  skipped: SkillsImportSkippedEntry[];
  warnings: string[];
};

const DEFAULT_IMPORT_TIMEOUT_MS = 60_000;

const IMPORT_IGNORED_NAMES = new Set([
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

function sanitizeSkillDirName(raw: string): string {
  const normalized = raw
    .trim()
    .replaceAll(/[/\\]+/g, "-")
    .replaceAll(/\s+/g, "-")
    .replaceAll(/[^a-zA-Z0-9_-]/g, "-")
    .replaceAll(/-+/g, "-")
    .replaceAll(/^[-_]+|[-_]+$/g, "")
    .slice(0, 64);
  return normalized || "skill";
}

function isUrlLike(value: string): boolean {
  return /^https?:\/\//i.test(value) || /^ssh:\/\//i.test(value);
}

function isGitSshLike(value: string): boolean {
  return /^git@[^:]+:.+/i.test(value);
}

function parseGitHubTreeUrl(
  source: string,
): { repoUrl: string; ref?: string; subdir?: string } | null {
  if (!/^https?:\/\//i.test(source)) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return null;
  }
  if (url.hostname !== "github.com") {
    return null;
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    return null;
  }
  const owner = parts[0];
  const repo = parts[1]?.replace(/\.git$/i, "");
  if (!owner || !repo) {
    return null;
  }
  if (parts.length >= 4 && (parts[2] === "tree" || parts[2] === "blob")) {
    const ref = parts[3];
    const rest = parts.slice(4).join("/");
    const subdir = rest ? rest.replace(/^\/+/, "") : undefined;
    return { repoUrl: `https://github.com/${owner}/${repo}.git`, ref, subdir };
  }
  return { repoUrl: `https://github.com/${owner}/${repo}.git` };
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function resolveSource(params: SkillsImportRequest): Promise<{
  rootDir: string;
  cleanup: () => Promise<void>;
  warnings: string[];
}> {
  const warnings: string[] = [];
  const rawSource = params.source.trim();
  if (!rawSource) {
    return {
      rootDir: "",
      cleanup: async () => {},
      warnings: ["missing source"],
    };
  }

  const githubTree = parseGitHubTreeUrl(rawSource);
  const normalizedGitUrl = githubTree?.repoUrl ?? rawSource;
  const normalizedRef = githubTree?.ref ?? params.ref;
  const normalizedSubdir = githubTree?.subdir ?? params.subdir;
  if (githubTree?.subdir && params.subdir) {
    warnings.push("Both source URL subdir and params.subdir were provided; using the URL subdir.");
  }
  if (githubTree?.ref && params.ref) {
    warnings.push("Both source URL ref and params.ref were provided; using the URL ref.");
  }

  const resolvedLocalPath = resolveUserPath(rawSource);
  const isGit = isUrlLike(normalizedGitUrl) || isGitSshLike(normalizedGitUrl) || /\.git$/i.test(rawSource);
  if (await pathExists(resolvedLocalPath)) {
    const rootDir = rawSource.endsWith(`${path.sep}SKILL.md`) || rawSource.endsWith("/SKILL.md")
      ? path.dirname(resolvedLocalPath)
      : resolvedLocalPath;
    const withSubdir = normalizedSubdir ? path.join(rootDir, normalizedSubdir) : rootDir;
    return {
      rootDir: withSubdir,
      cleanup: async () => {},
      warnings,
    };
  }

  if (!isGit) {
    warnings.push(`source path does not exist: ${resolvedLocalPath}`);
    return { rootDir: "", cleanup: async () => {}, warnings };
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-skill-import-"));
  const repoDir = path.join(tmpDir, "repo");

  const timeoutMs =
    typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs)
      ? Math.max(1_000, Math.floor(params.timeoutMs))
      : DEFAULT_IMPORT_TIMEOUT_MS;

  const tryClone = async (argv: string[], opts?: { cwd?: string }) => {
    try {
      return await runCommandWithTimeout(argv, { timeoutMs, ...(opts?.cwd ? { cwd: opts.cwd } : {}) });
    } catch (err) {
      return {
        stdout: "",
        stderr: String(err),
        code: 1,
        signal: null,
        killed: false,
      };
    }
  };

  const shallowCloneArgs = ["git", "clone", "--depth", "1"];
  if (normalizedRef) {
    shallowCloneArgs.push("--branch", normalizedRef);
  }
  shallowCloneArgs.push(normalizedGitUrl, repoDir);
  const clone = await tryClone(shallowCloneArgs);
  if (clone.code !== 0) {
    // Fallback for commit SHAs / uncommon refs: full clone + checkout.
    const fullClone = await tryClone(["git", "clone", normalizedGitUrl, repoDir]);
    if (fullClone.code !== 0) {
      await fs.rm(tmpDir, { recursive: true, force: true });
      warnings.push(
        clone.stderr.trim() ||
          clone.stdout.trim() ||
          fullClone.stderr.trim() ||
          fullClone.stdout.trim() ||
          `git clone failed (exit ${fullClone.code ?? clone.code ?? "unknown"})`,
      );
      return { rootDir: "", cleanup: async () => {}, warnings };
    }
  }

  if (normalizedRef) {
    const checkout = await tryClone(["git", "checkout", normalizedRef], { cwd: repoDir });
    if (checkout.code !== 0) {
      warnings.push(
        checkout.stderr.trim() ||
        checkout.stdout.trim() ||
          `git checkout failed (exit ${checkout.code ?? "unknown"})`,
      );
    }
  }

  const root = normalizedSubdir ? path.join(repoDir, normalizedSubdir) : repoDir;
  return {
    rootDir: root,
    cleanup: async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    },
    warnings,
  };
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
      if (IMPORT_IGNORED_NAMES.has(entry.name)) {
        continue;
      }
      await walk(path.join(dir, entry.name), depth + 1);
    }
  };

  await walk(rootDir, 0);
  return [...found].toSorted();
}

function resolveTargetDir(params: SkillsImportRequest): string | null {
  if (params.target === "managed") {
    return params.managedSkillsDir?.trim()
      ? resolveUserPath(params.managedSkillsDir)
      : path.join(CONFIG_DIR, "skills");
  }
  const workspaceDir = params.workspaceDir?.trim();
  if (!workspaceDir) {
    return null;
  }
  return path.join(resolveUserPath(workspaceDir), "skills");
}

export async function importSkills(params: SkillsImportRequest): Promise<SkillsImportResult> {
  const targetDir = resolveTargetDir(params);
  if (!targetDir) {
    return {
      ok: false,
      message: "workspaceDir required when target=workspace",
      targetDir: "",
      imported: [],
      skipped: [],
      warnings: [],
    };
  }

  return await serializeByKey(`skillsImport:${targetDir}`, async () => {
    const imported: SkillsImportEntry[] = [];
    const skipped: SkillsImportSkippedEntry[] = [];
    const warnings: string[] = [];

    const resolved = await resolveSource(params);
    warnings.push(...resolved.warnings);
    if (!resolved.rootDir) {
      return {
        ok: false,
        message: warnings.at(-1) ?? "failed to resolve source",
        targetDir,
        imported,
        skipped,
        warnings,
      };
    }

    try {
      if (!(await pathExists(resolved.rootDir))) {
        return {
          ok: false,
          message: `source not found: ${resolved.rootDir}`,
          targetDir,
          imported,
          skipped,
          warnings,
        };
      }

      await ensureDir(targetDir);
      const skillDirs = await collectSkillDirs(resolved.rootDir);
      if (skillDirs.length === 0) {
        return {
          ok: false,
          message: "no SKILL.md found in source",
          targetDir,
          imported,
          skipped,
          warnings,
        };
      }

      const usedDestNames = new Set<string>();
      for (const skillDir of skillDirs) {
        const skillPath = path.join(skillDir, "SKILL.md");
        let content: string;
        try {
          content = await fs.readFile(skillPath, "utf-8");
        } catch (err) {
          skipped.push({
            sourceDir: skillDir,
            reason: "invalid-skill",
            message: `failed to read SKILL.md: ${String(err)}`,
          });
          continue;
        }
        let name: string | undefined;
        try {
          const fm = parseFrontmatter(content);
          if (typeof fm.name === "string" && fm.name.trim()) {
            name = fm.name.trim();
          }
        } catch {
          // ignore; still import based on directory name
        }

        const dirNameBase = sanitizeSkillDirName(name ?? path.basename(skillDir));
        const dirName = usedDestNames.has(dirNameBase) ? `${dirNameBase}-${usedDestNames.size + 1}` : dirNameBase;
        usedDestNames.add(dirName);
        const destDir = path.join(targetDir, dirName);

        const exists = await pathExists(destDir);
        if (exists && params.overwrite !== true) {
          skipped.push({
            sourceDir: skillDir,
            reason: "conflict",
            message: `destination exists: ${destDir}`,
          });
          continue;
        }

        if (exists && params.overwrite === true) {
          await fs.rm(destDir, { recursive: true, force: true });
        }

        try {
          await fs.cp(skillDir, destDir, {
            recursive: true,
            force: true,
            dereference: false,
            filter: (src) => {
              const base = path.basename(src);
              return !IMPORT_IGNORED_NAMES.has(base);
            },
          });
        } catch (err) {
          skipped.push({
            sourceDir: skillDir,
            reason: "copy-failed",
            message: `copy failed: ${String(err)}`,
          });
          continue;
        }

        imported.push({
          name,
          sourceDir: skillDir,
          destDir,
          skillPath: path.join(destDir, "SKILL.md"),
        });
      }
    } finally {
      await resolved.cleanup();
    }

    const ok = imported.length > 0;
    const message = ok
      ? `Imported ${imported.length} skill(s) into ${targetDir}`
      : skipped.length > 0
        ? "No skills imported (see skipped entries)"
        : "No skills imported";

    return { ok, message, targetDir, imported, skipped, warnings };
  });
}
