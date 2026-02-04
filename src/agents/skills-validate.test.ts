import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { validateImportedSkills } from "./skills-validate.js";

async function makeTmpDir(prefix: string) {
  return await fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeSkillDir(params: { dir: string; name: string; description?: string }) {
  await fs.mkdir(params.dir, { recursive: true });
  const content = [
    "---",
    `name: ${params.name}`,
    ...(params.description ? [`description: ${params.description}`] : []),
    "---",
    "",
    `# ${params.name}`,
    "",
  ].join("\n");
  await fs.writeFile(path.join(params.dir, "SKILL.md"), content, "utf-8");
}

describe("validateImportedSkills", () => {
  it("marks a valid imported skill as loaded+ready", async () => {
    const root = await makeTmpDir("openclaw-skills-validate-test-");
    const workspaceDir = path.join(root, "workspace");
    const destDir = path.join(workspaceDir, "skills", "validate-skill-ok");

    try {
      await writeSkillDir({
        dir: destDir,
        name: "validate-skill-ok",
        description: "Test skill",
      });

      const report = await validateImportedSkills({
        workspaceDir,
        imported: [
          {
            name: "validate-skill-ok",
            sourceDir: destDir,
            destDir,
            skillPath: path.join(destDir, "SKILL.md"),
          },
        ],
        config: {},
      });

      expect(report.ok).toBe(true);
      expect(report.summary.total).toBe(1);
      expect(report.summary.loaded).toBe(1);
      expect(report.summary.ready).toBe(1);
      expect(report.skills[0]?.loaded).toBe(true);
      expect(report.skills[0]?.ready).toBe(true);
      expect(report.skills[0]?.rewriteRecommended).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("flags skills missing description as not loaded + rewrite recommended", async () => {
    const root = await makeTmpDir("openclaw-skills-validate-test-");
    const workspaceDir = path.join(root, "workspace");
    const destDir = path.join(workspaceDir, "skills", "validate-skill-bad");

    try {
      await writeSkillDir({
        dir: destDir,
        name: "validate-skill-bad",
      });

      const report = await validateImportedSkills({
        workspaceDir,
        imported: [
          {
            name: "validate-skill-bad",
            sourceDir: destDir,
            destDir,
            skillPath: path.join(destDir, "SKILL.md"),
          },
        ],
        config: {},
      });

      expect(report.ok).toBe(false);
      expect(report.summary.total).toBe(1);
      expect(report.summary.loaded).toBe(0);
      expect(report.skills[0]?.loaded).toBe(false);
      expect(report.skills[0]?.rewriteRecommended).toBe(true);
      expect(report.skills[0]?.rewriteReasons.join("\n")).toMatch(/description/i);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

