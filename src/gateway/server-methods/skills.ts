import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { discoverSkills } from "../../agents/skills-discover.js";
import { importSkills } from "../../agents/skills-import.js";
import { installSkill } from "../../agents/skills-install.js";
import { buildWorkspaceSkillStatus } from "../../agents/skills-status.js";
import { validateImportedSkills } from "../../agents/skills-validate.js";
import { loadWorkspaceSkillEntries, type SkillEntry } from "../../agents/skills.js";
import { bumpSkillsSnapshotVersion } from "../../agents/skills/refresh.js";
import type { OpenClawConfig } from "../../config/config.js";
import { loadConfig, writeConfigFile } from "../../config/config.js";
import { getRemoteSkillEligibility } from "../../infra/skills-remote.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateSkillsBinsParams,
  validateSkillsDiscoverParams,
  validateSkillsAddParams,
  validateSkillsImportParams,
  validateSkillsInstallParams,
  validateSkillsStatusParams,
  validateSkillsUpdateParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

function listWorkspaceDirs(cfg: OpenClawConfig): string[] {
  const dirs = new Set<string>();
  const list = cfg.agents?.list;
  if (Array.isArray(list)) {
    for (const entry of list) {
      if (entry && typeof entry === "object" && typeof entry.id === "string") {
        dirs.add(resolveAgentWorkspaceDir(cfg, entry.id));
      }
    }
  }
  dirs.add(resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg)));
  return [...dirs];
}

function collectSkillBins(entries: SkillEntry[]): string[] {
  const bins = new Set<string>();
  for (const entry of entries) {
    const required = entry.metadata?.requires?.bins ?? [];
    const anyBins = entry.metadata?.requires?.anyBins ?? [];
    const install = entry.metadata?.install ?? [];
    for (const bin of required) {
      const trimmed = bin.trim();
      if (trimmed) {
        bins.add(trimmed);
      }
    }
    for (const bin of anyBins) {
      const trimmed = bin.trim();
      if (trimmed) {
        bins.add(trimmed);
      }
    }
    for (const spec of install) {
      const specBins = spec?.bins ?? [];
      for (const bin of specBins) {
        const trimmed = String(bin).trim();
        if (trimmed) {
          bins.add(trimmed);
        }
      }
    }
  }
  return [...bins].toSorted();
}

export const skillsHandlers: GatewayRequestHandlers = {
  "skills.status": ({ params, respond }) => {
    if (!validateSkillsStatusParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skills.status params: ${formatValidationErrors(validateSkillsStatusParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const workspaceDir = resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg));
    const report = buildWorkspaceSkillStatus(workspaceDir, {
      config: cfg,
      eligibility: { remote: getRemoteSkillEligibility() },
    });
    respond(true, report, undefined);
  },
  "skills.bins": ({ params, respond }) => {
    if (!validateSkillsBinsParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skills.bins params: ${formatValidationErrors(validateSkillsBinsParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const workspaceDirs = listWorkspaceDirs(cfg);
    const bins = new Set<string>();
    for (const workspaceDir of workspaceDirs) {
      const entries = loadWorkspaceSkillEntries(workspaceDir, { config: cfg });
      for (const bin of collectSkillBins(entries)) {
        bins.add(bin);
      }
    }
    respond(true, { bins: [...bins].toSorted() }, undefined);
  },
  "skills.discover": async ({ params, respond }) => {
    if (!validateSkillsDiscoverParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skills.discover params: ${formatValidationErrors(validateSkillsDiscoverParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as {
      prompt: string;
      limit?: number;
      mode?: "auto" | "skill-pool" | "github";
      githubToken?: string;
      timeoutMs?: number;
    };
    const result = await discoverSkills({
      prompt: p.prompt,
      limit: p.limit,
      mode: p.mode,
      githubToken: p.githubToken,
      timeoutMs: p.timeoutMs,
    });
    respond(result.ok, result, result.ok ? undefined : errorShape(ErrorCodes.UNAVAILABLE, result.message));
  },
  "skills.add": async ({ params, respond }) => {
    if (!validateSkillsAddParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skills.add params: ${formatValidationErrors(validateSkillsAddParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as {
      prompt: string;
      target?: "workspace" | "managed";
      overwrite?: boolean;
      autoInstall?: boolean;
      mode?: "auto" | "skill-pool" | "github";
      githubToken?: string;
      timeoutMs?: number;
    };
    const discovered = await discoverSkills({
      prompt: p.prompt,
      limit: 5,
      mode: p.mode,
      githubToken: p.githubToken,
      timeoutMs: p.timeoutMs,
    });
    if (!discovered.ok || discovered.candidates.length === 0) {
      respond(false, discovered, errorShape(ErrorCodes.UNAVAILABLE, discovered.message));
      return;
    }

    const candidate = discovered.candidates[0];
    const cfg = loadConfig();
    const workspaceDirRaw = resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg));
    const imported = await importSkills({
      source: candidate.source,
      target: p.target ?? "workspace",
      workspaceDir: workspaceDirRaw,
      overwrite: p.overwrite,
      timeoutMs: p.timeoutMs,
    });

    const eligibility = { remote: getRemoteSkillEligibility() };
    let validation = imported.ok
      ? await validateImportedSkills({
          workspaceDir: workspaceDirRaw,
          imported: imported.imported,
          config: cfg,
          eligibility,
        })
      : undefined;

    const autoInstallResults: Array<{
      name: string;
      installId: string;
      ok: boolean;
      message: string;
      stdout: string;
      stderr: string;
      code: number | null;
    }> = [];

    if (imported.ok && p.autoInstall && validation) {
      for (const entry of validation.skills) {
        const status = entry.status;
        if (!status) {
          continue;
        }
        if (status.eligible) {
          continue;
        }
        if (status.install.length === 0) {
          continue;
        }
        if (status.missing.os.length > 0) {
          continue;
        }
        const missingBins = status.missing.bins.length > 0 || status.missing.anyBins.length > 0;
        if (!missingBins) {
          continue;
        }

        const installId = status.install[0]?.id;
        if (!installId) {
          continue;
        }
        const installResult = await installSkill({
          workspaceDir: workspaceDirRaw,
          skillName: status.name,
          installId,
          timeoutMs: p.timeoutMs,
          config: cfg,
        });
        autoInstallResults.push({ name: status.name, installId, ...installResult });
      }

      validation = await validateImportedSkills({
        workspaceDir: workspaceDirRaw,
        imported: imported.imported,
        config: cfg,
        eligibility,
      });
    }

    const result = {
      ok: imported.ok,
      candidate,
      import: imported,
      ...(validation ? { validation } : {}),
      ...(autoInstallResults.length > 0
        ? { autoInstall: { attempted: autoInstallResults.length, results: autoInstallResults } }
        : {}),
      discovery: {
        message: discovered.message,
        warnings: discovered.warnings,
      },
    };
    if (imported.ok) {
      bumpSkillsSnapshotVersion({ reason: "manual" });
    }
    respond(
      imported.ok,
      result,
      imported.ok ? undefined : errorShape(ErrorCodes.UNAVAILABLE, imported.message),
    );
  },
  "skills.install": async ({ params, respond }) => {
    if (!validateSkillsInstallParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skills.install params: ${formatValidationErrors(validateSkillsInstallParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as {
      name: string;
      installId: string;
      timeoutMs?: number;
    };
    const cfg = loadConfig();
    const workspaceDirRaw = resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg));
    const result = await installSkill({
      workspaceDir: workspaceDirRaw,
      skillName: p.name,
      installId: p.installId,
      timeoutMs: p.timeoutMs,
      config: cfg,
    });
    if (result.ok) {
      bumpSkillsSnapshotVersion({ reason: "manual" });
    }
    respond(
      result.ok,
      result,
      result.ok ? undefined : errorShape(ErrorCodes.UNAVAILABLE, result.message),
    );
  },
  "skills.import": async ({ params, respond }) => {
    if (!validateSkillsImportParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skills.import params: ${formatValidationErrors(validateSkillsImportParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as {
      source: string;
      target?: "workspace" | "managed";
      ref?: string;
      subdir?: string;
      overwrite?: boolean;
      autoInstall?: boolean;
      timeoutMs?: number;
    };
    const cfg = loadConfig();
    const workspaceDirRaw = resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg));
    const result = await importSkills({
      source: p.source,
      target: p.target ?? "workspace",
      workspaceDir: workspaceDirRaw,
      ref: p.ref,
      subdir: p.subdir,
      overwrite: p.overwrite,
      timeoutMs: p.timeoutMs,
    });

    const eligibility = { remote: getRemoteSkillEligibility() };
    let validation = result.ok
      ? await validateImportedSkills({
          workspaceDir: workspaceDirRaw,
          imported: result.imported,
          config: cfg,
          eligibility,
        })
      : undefined;

    const autoInstallResults: Array<{
      name: string;
      installId: string;
      ok: boolean;
      message: string;
      stdout: string;
      stderr: string;
      code: number | null;
    }> = [];

    if (result.ok && p.autoInstall && validation) {
      for (const entry of validation.skills) {
        const status = entry.status;
        if (!status) {
          continue;
        }
        if (status.eligible) {
          continue;
        }
        if (status.install.length === 0) {
          continue;
        }
        if (status.missing.os.length > 0) {
          continue;
        }
        const missingBins = status.missing.bins.length > 0 || status.missing.anyBins.length > 0;
        if (!missingBins) {
          continue;
        }

        const installId = status.install[0]?.id;
        if (!installId) {
          continue;
        }
        const installResult = await installSkill({
          workspaceDir: workspaceDirRaw,
          skillName: status.name,
          installId,
          timeoutMs: p.timeoutMs,
          config: cfg,
        });
        autoInstallResults.push({ name: status.name, installId, ...installResult });
      }

      validation = await validateImportedSkills({
        workspaceDir: workspaceDirRaw,
        imported: result.imported,
        config: cfg,
        eligibility,
      });
    }

    if (result.ok) {
      bumpSkillsSnapshotVersion({ reason: "manual" });
    }
    respond(
      result.ok,
      {
        ...result,
        ...(validation ? { validation } : {}),
        ...(autoInstallResults.length > 0
          ? { autoInstall: { attempted: autoInstallResults.length, results: autoInstallResults } }
          : {}),
      },
      result.ok ? undefined : errorShape(ErrorCodes.UNAVAILABLE, result.message),
    );
  },
  "skills.update": async ({ params, respond }) => {
    if (!validateSkillsUpdateParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skills.update params: ${formatValidationErrors(validateSkillsUpdateParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as {
      skillKey: string;
      enabled?: boolean;
      apiKey?: string;
      env?: Record<string, string>;
    };
    const cfg = loadConfig();
    const skills = cfg.skills ? { ...cfg.skills } : {};
    const entries = skills.entries ? { ...skills.entries } : {};
    const current = entries[p.skillKey] ? { ...entries[p.skillKey] } : {};
    if (typeof p.enabled === "boolean") {
      current.enabled = p.enabled;
    }
    if (typeof p.apiKey === "string") {
      const trimmed = p.apiKey.trim();
      if (trimmed) {
        current.apiKey = trimmed;
      } else {
        delete current.apiKey;
      }
    }
    if (p.env && typeof p.env === "object") {
      const nextEnv = current.env ? { ...current.env } : {};
      for (const [key, value] of Object.entries(p.env)) {
        const trimmedKey = key.trim();
        if (!trimmedKey) {
          continue;
        }
        const trimmedVal = value.trim();
        if (!trimmedVal) {
          delete nextEnv[trimmedKey];
        } else {
          nextEnv[trimmedKey] = trimmedVal;
        }
      }
      current.env = nextEnv;
    }
    entries[p.skillKey] = current;
    skills.entries = entries;
    const nextConfig: OpenClawConfig = {
      ...cfg,
      skills,
    };
    await writeConfigFile(nextConfig);
    bumpSkillsSnapshotVersion({ reason: "manual" });
    respond(true, { ok: true, skillKey: p.skillKey, config: current }, undefined);
  },
};
