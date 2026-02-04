import { describe, expect, it, vi } from "vitest";

const bumpSkillsSnapshotVersionMock = vi.fn();
const loadConfigMock = vi.fn(() => ({}));
const writeConfigFileMock = vi.fn(async () => undefined);
const installSkillMock = vi.fn(async () => ({
  ok: true,
  message: "ok",
  stdout: "",
  stderr: "",
  code: 0,
}));
const importSkillsMock = vi.fn(async () => ({
  ok: true,
  message: "ok",
  targetDir: "/tmp/skills",
  imported: [],
  skipped: [],
  warnings: [],
}));

vi.mock("../../agents/skills/refresh.js", () => ({
  bumpSkillsSnapshotVersion: (...args: unknown[]) => bumpSkillsSnapshotVersionMock(...args),
}));

vi.mock("../../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/config.js")>();
  return {
    ...actual,
    loadConfig: () => loadConfigMock(),
    writeConfigFile: (cfg: unknown) => writeConfigFileMock(cfg),
  };
});

vi.mock("../../agents/skills-install.js", () => ({
  installSkill: (req: unknown) => installSkillMock(req),
}));

vi.mock("../../agents/skills-import.js", () => ({
  importSkills: (req: unknown) => importSkillsMock(req),
}));

describe("skills gateway methods", () => {
  it("bumps skills snapshot version after skills.update", async () => {
    bumpSkillsSnapshotVersionMock.mockClear();
    writeConfigFileMock.mockClear();

    const mod = await import("./skills.js");
    const respond = vi.fn();
    await mod.skillsHandlers["skills.update"]({
      params: { skillKey: "test-skill", enabled: true },
      respond,
    } as never);

    expect(writeConfigFileMock).toHaveBeenCalledTimes(1);
    expect(bumpSkillsSnapshotVersionMock).toHaveBeenCalledTimes(1);
  });

  it("bumps skills snapshot version after successful skills.install", async () => {
    bumpSkillsSnapshotVersionMock.mockClear();
    installSkillMock.mockResolvedValueOnce({
      ok: true,
      message: "ok",
      stdout: "",
      stderr: "",
      code: 0,
    });

    const mod = await import("./skills.js");
    const respond = vi.fn();
    await mod.skillsHandlers["skills.install"]({
      params: { name: "test-skill", installId: "brew-0" },
      respond,
    } as never);

    expect(bumpSkillsSnapshotVersionMock).toHaveBeenCalledTimes(1);
  });

  it("bumps skills snapshot version after successful skills.import", async () => {
    bumpSkillsSnapshotVersionMock.mockClear();
    importSkillsMock.mockResolvedValueOnce({
      ok: true,
      message: "ok",
      targetDir: "/tmp/skills",
      imported: [{ name: "hello", sourceDir: "/tmp/src", destDir: "/tmp/dest", skillPath: "/tmp/dest/SKILL.md" }],
      skipped: [],
      warnings: [],
    });

    const mod = await import("./skills.js");
    const respond = vi.fn();
    await mod.skillsHandlers["skills.import"]({
      params: { source: "https://example.com/repo.git" },
      respond,
    } as never);

    expect(bumpSkillsSnapshotVersionMock).toHaveBeenCalledTimes(1);
  });
});

