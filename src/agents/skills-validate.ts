import fs from "node:fs/promises";
import path from "node:path";

import JSON5 from "json5";
import { loadSkillsFromDir, type Skill } from "@mariozechner/pi-coding-agent";

import { LEGACY_MANIFEST_KEYS, MANIFEST_KEY } from "../compat/legacy-names.js";
import type { OpenClawConfig } from "../config/config.js";
import {
  loadWorkspaceSkillEntries,
  type OpenClawSkillMetadata,
  type SkillEligibilityContext,
  type SkillEntry,
} from "./skills.js";
import { parseFrontmatter, resolveOpenClawMetadata } from "./skills/frontmatter.js";
import { buildWorkspaceSkillStatus, type SkillStatusEntry, type SkillStatusReport } from "./skills-status.js";
import type { SkillsImportEntry } from "./skills-import.js";

type PiDiagnostic = {
  type: string;
  message: string;
  path?: string;
};

type NormalizedPiLoadResult = {
  skills: Skill[];
  diagnostics: PiDiagnostic[];
};

function normalizePath(p: string): string {
  return path.resolve(p);
}

function normalizePiLoadResult(result: unknown): NormalizedPiLoadResult {
  if (Array.isArray(result)) {
    return { skills: result as Skill[], diagnostics: [] };
  }
  if (
    result &&
    typeof result === "object" &&
    "skills" in result &&
    Array.isArray((result as { skills?: unknown }).skills)
  ) {
    const parsed = result as { skills: Skill[]; diagnostics?: unknown };
    const diagnostics = Array.isArray(parsed.diagnostics) ? (parsed.diagnostics as PiDiagnostic[]) : [];
    return { skills: parsed.skills, diagnostics };
  }
  return { skills: [], diagnostics: [] };
}

function extractJson5ErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return String(err);
}

function inspectOpenClawMetadata(frontmatter: Record<string, string>): {
  present: boolean;
  parseOk: boolean;
  manifestFound: boolean;
  error?: string;
  metadata?: OpenClawSkillMetadata;
} {
  const raw = typeof frontmatter.metadata === "string" ? frontmatter.metadata.trim() : "";
  if (!raw) {
    return { present: false, parseOk: true, manifestFound: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON5.parse(raw);
  } catch (err) {
    return {
      present: true,
      parseOk: false,
      manifestFound: false,
      error: extractJson5ErrorMessage(err),
    };
  }

  if (!parsed || typeof parsed !== "object") {
    return {
      present: true,
      parseOk: false,
      manifestFound: false,
      error: "metadata must be a JSON object",
    };
  }

  const candidates = [MANIFEST_KEY, ...LEGACY_MANIFEST_KEYS];
  const parsedObj = parsed as Record<string, unknown>;
  const manifestFound = candidates.some((key) => {
    const value = parsedObj[key];
    return Boolean(value && typeof value === "object");
  });

  const metadata = resolveOpenClawMetadata(frontmatter);
  return {
    present: true,
    parseOk: true,
    manifestFound,
    ...(metadata ? { metadata } : {}),
  };
}

function findSkillEntryByPath(entries: SkillEntry[], skillPath: string): SkillEntry | undefined {
  const target = normalizePath(skillPath);
  return entries.find((entry) => normalizePath(entry.skill.filePath) === target);
}

function findSkillStatusByPath(report: SkillStatusReport, skillPath: string): SkillStatusEntry | undefined {
  const target = normalizePath(skillPath);
  return report.skills.find((entry) => normalizePath(entry.filePath) === target);
}

function findAnyNameCollision(params: {
  entries: SkillEntry[];
  importedPath: string;
  skillName: string;
}): { winnerPath: string; winnerSource: string } | undefined {
  const importedPath = normalizePath(params.importedPath);
  const normalizedName = params.skillName.trim();
  if (!normalizedName) {
    return undefined;
  }
  for (const entry of params.entries) {
    if (entry.skill.name !== normalizedName) {
      continue;
    }
    const winnerPath = normalizePath(entry.skill.filePath);
    if (winnerPath !== importedPath) {
      return { winnerPath: entry.skill.filePath, winnerSource: entry.skill.source };
    }
  }
  return undefined;
}

function shouldRecommendRewrite(params: {
  loaded: boolean;
  diagnostics: PiDiagnostic[];
  metadataInspection: ReturnType<typeof inspectOpenClawMetadata>;
  status?: SkillStatusEntry;
  collision?: { winnerPath: string; winnerSource: string };
}): { recommended: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (!params.loaded) {
    reasons.push("Skill not loaded by OpenClaw (likely missing description or invalid frontmatter).");
  }

  if (params.collision) {
    reasons.push(
      `Skill name collides with another loaded skill: ${params.collision.winnerSource} (${params.collision.winnerPath}).`,
    );
  }

  if (params.metadataInspection.present && !params.metadataInspection.parseOk) {
    reasons.push(`Invalid JSON5 in frontmatter metadata: ${params.metadataInspection.error ?? "parse error"}.`);
  }

  if (params.metadataInspection.present && params.metadataInspection.parseOk && !params.metadataInspection.manifestFound) {
    reasons.push("Frontmatter metadata is present but does not include an OpenClaw manifest key.");
  }

  const diagnosticMessages = params.diagnostics.map((diag) => diag.message);
  const interesting = diagnosticMessages.filter((message) =>
    /(description is required|unknown frontmatter field|name contains invalid characters|does not match parent directory|failed to parse)/i.test(
      message,
    ),
  );
  for (const msg of Array.from(new Set(interesting)).slice(0, 5)) {
    reasons.push(`Agent Skills spec warning: ${msg}`);
  }

  const status = params.status;
  if (status && !status.eligible) {
    const missingBins = status.missing.bins.length > 0 || status.missing.anyBins.length > 0;
    if (missingBins && status.install.length === 0) {
      reasons.push("Missing required binaries but no installer is declared in OpenClaw metadata.");
    }
  }

  const unique = Array.from(new Set(reasons.map((r) => r.trim()).filter(Boolean)));
  return { recommended: unique.length > 0, reasons: unique };
}

export type SkillValidationEntry = {
  destDir: string;
  skillPath: string;
  importedName?: string;
  declaredName?: string;
  loadedName?: string;
  description?: string;
  loaded: boolean;
  diagnostics: PiDiagnostic[];
  metadata: {
    present: boolean;
    parseOk: boolean;
    manifestFound: boolean;
    error?: string;
  };
  status?: SkillStatusEntry;
  ready: boolean;
  rewriteRecommended: boolean;
  rewriteReasons: string[];
};

export type SkillsValidationReport = {
  ok: boolean;
  message: string;
  summary: {
    total: number;
    loaded: number;
    ready: number;
    rewriteRecommended: number;
  };
  skills: SkillValidationEntry[];
};

export async function validateImportedSkills(params: {
  workspaceDir: string;
  imported: SkillsImportEntry[];
  config?: OpenClawConfig;
  eligibility?: SkillEligibilityContext;
}): Promise<SkillsValidationReport> {
  const entries = loadWorkspaceSkillEntries(params.workspaceDir, { config: params.config });
  const report = buildWorkspaceSkillStatus(params.workspaceDir, {
    config: params.config,
    eligibility: params.eligibility,
  });

  const validations: SkillValidationEntry[] = [];
  for (const imported of params.imported) {
    const skillPath = normalizePath(imported.skillPath);
    let content = "";
    try {
      content = await fs.readFile(skillPath, "utf-8");
    } catch (err) {
      validations.push({
        destDir: imported.destDir,
        skillPath: imported.skillPath,
        importedName: imported.name,
        loaded: false,
        diagnostics: [{ type: "error", message: `Failed to read SKILL.md: ${String(err)}`, path: imported.skillPath }],
        metadata: { present: false, parseOk: true, manifestFound: false },
        ready: false,
        rewriteRecommended: true,
        rewriteReasons: ["Failed to read SKILL.md."],
      });
      continue;
    }

    const frontmatter = parseFrontmatter(content);
    const declaredName = typeof frontmatter.name === "string" ? frontmatter.name.trim() : undefined;
    const metadataInspection = inspectOpenClawMetadata(frontmatter);

    const piLoad = normalizePiLoadResult(loadSkillsFromDir({ dir: imported.destDir, source: "openclaw-import" }));
    const piDiagnostics = piLoad.diagnostics.filter((diag) => {
      const diagPath = typeof diag.path === "string" ? diag.path : "";
      return diagPath ? normalizePath(diagPath) === skillPath : false;
    });
    const piSkill = piLoad.skills.find((skill) => normalizePath(skill.filePath) === skillPath);

    const entry = findSkillEntryByPath(entries, skillPath);
    const status = findSkillStatusByPath(report, skillPath);

    const loadedName = piSkill?.name ?? entry?.skill.name;
    const collision =
      !entry && loadedName
        ? findAnyNameCollision({ entries, importedPath: skillPath, skillName: loadedName })
        : undefined;

    const loaded = Boolean(entry);
    const ready = Boolean(loaded && status?.eligible);
    const rewrite = shouldRecommendRewrite({
      loaded,
      diagnostics: piDiagnostics,
      metadataInspection,
      status,
      collision,
    });

    validations.push({
      destDir: imported.destDir,
      skillPath: imported.skillPath,
      importedName: imported.name,
      declaredName,
      ...(loadedName ? { loadedName } : {}),
      ...(piSkill?.description ? { description: piSkill.description } : {}),
      loaded,
      diagnostics: piDiagnostics,
      metadata: {
        present: metadataInspection.present,
        parseOk: metadataInspection.parseOk,
        manifestFound: metadataInspection.manifestFound,
        ...(metadataInspection.error ? { error: metadataInspection.error } : {}),
      },
      ...(status ? { status } : {}),
      ready,
      rewriteRecommended: rewrite.recommended,
      rewriteReasons: rewrite.reasons,
    });
  }

  const total = validations.length;
  const loadedCount = validations.filter((v) => v.loaded).length;
  const readyCount = validations.filter((v) => v.ready).length;
  const rewriteCount = validations.filter((v) => v.rewriteRecommended).length;
  const ok = total > 0 && readyCount === total;

  const parts = [`Validated ${total} imported skill(s)`];
  if (readyCount !== total) {
    parts.push(`${readyCount}/${total} ready`);
  }
  if (rewriteCount > 0) {
    parts.push(`${rewriteCount} need rewrite/patch-up`);
  }

  return {
    ok,
    message: parts.join("; "),
    summary: { total, loaded: loadedCount, ready: readyCount, rewriteRecommended: rewriteCount },
    skills: validations,
  };
}

