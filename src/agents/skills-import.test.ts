import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { importSkills } from "./skills-import.js";

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

describe("importSkills", () => {
  it("imports a local skill directory into the workspace skills dir", async () => {
    const root = await makeTmpDir("openclaw-skills-import-test-");
    const workspaceDir = path.join(root, "workspace");
    const sourceSkillDir = path.join(root, "source-skill");

    try {
      await writeSkillDir({
        dir: sourceSkillDir,
        name: "hello_world",
        description: "Test skill",
      });

      const result = await importSkills({
        source: sourceSkillDir,
        target: "workspace",
        workspaceDir,
      });

      expect(result.ok).toBe(true);
      expect(result.imported.map((entry) => entry.name)).toContain("hello_world");

      const installed = path.join(workspaceDir, "skills", "hello_world", "SKILL.md");
      const installedContent = await fs.readFile(installed, "utf-8");
      expect(installedContent).toContain("name: hello_world");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("skips conflicts unless overwrite is true", async () => {
    const root = await makeTmpDir("openclaw-skills-import-test-");
    const workspaceDir = path.join(root, "workspace");
    const sourceSkillDir = path.join(root, "source-skill");

    try {
      await writeSkillDir({ dir: sourceSkillDir, name: "dup_skill" });

      const first = await importSkills({
        source: sourceSkillDir,
        target: "workspace",
        workspaceDir,
      });
      expect(first.ok).toBe(true);

      const second = await importSkills({
        source: sourceSkillDir,
        target: "workspace",
        workspaceDir,
      });
      expect(second.ok).toBe(false);
      expect(second.skipped.some((s) => s.reason === "conflict")).toBe(true);

      const third = await importSkills({
        source: sourceSkillDir,
        target: "workspace",
        workspaceDir,
        overwrite: true,
      });
      expect(third.ok).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

