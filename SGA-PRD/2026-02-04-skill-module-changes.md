---
title: "Skills 模块改造记录（2026-02-04）"
---

# 目标

让 Moltbot/OpenClaw 能够在“导入技能（skill）”之后自动做 OpenClaw-native 校验，并（可选）自动安装缺失依赖，然后再决定是否需要进一步的“飞轮式重写/补全”。

# 关键变动（代码）

## 1) Prompt → 技能发现 → 一键添加

- 新增 `skills.discover`：优先使用 skill-pool 的 JSON 索引做匹配；找不到再走 GitHub Repo Search（按 star 排序），clone 后扫描 `SKILL.md` 并打分挑选最佳候选。
- 新增 `skills.add`：发现后直接导入最佳候选技能。

## 2) Git/本地路径导入

- 新增 `openclaw skills import <source>`：支持 git URL / GitHub tree URL / 本地路径导入技能目录（递归扫描 `SKILL.md`）。

## 3) Import 后自动校验（本次重点）

- 新增 OpenClaw-native 校验 `validateImportedSkills(...)`：
  - 校验技能是否能被 OpenClaw 实际加载（基于 OpenClaw 的 skills loader + gating 规则）。
  - 解析 `SKILL.md` frontmatter，检查 metadata JSON5 是否可解析、是否包含 OpenClaw manifest key。
  - 计算缺失 requirements（bins/env/config/os）并输出可用 installer（如果 skill 声明了 `metadata.openclaw.install`）。
  - 给出 `rewriteRecommended` 与原因（例如：未加载、frontmatter 警告、metadata 不规范、缺 bins 但没 installer 等）。
- `skills.import` / `skills.add` 会在导入成功后自动返回 `validation`。

## 4) 可选：自动安装缺失依赖

- `skills.import` / `skills.add` 新增 `autoInstall`（默认 false）：
  - 当技能缺 bins 且声明了 installer（`metadata.openclaw.install`）时，自动尝试安装首选 installer。
  - 安装后会再次运行校验并返回最新的 `validation`。

# 使用方式

- CLI：
  - `openclaw skills import <source>`
  - `openclaw skills import <source> --auto-install`
- Agent 工具：
  - `skills` tool：`action=add|import` + `autoInstall: true`

# 备注

- GitHub API 限流：建议设置 `GITHUB_TOKEN`（或 `GH_TOKEN`）。
- 安全：第三方技能等同于“可执行指令集”，导入后建议先阅读再启用/运行。

