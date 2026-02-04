---
summary: "CLI reference for `openclaw skills` (list/info/check) and skill eligibility"
read_when:
  - You want to see which skills are available and ready to run
  - You want to debug missing binaries/env/config for skills
---

# `openclaw skills`

Inspect skills (bundled + workspace + managed overrides) and see what’s eligible vs missing requirements.

Related:

- Skills system: [Skills](/tools/skills)
- Skills config: [Skills config](/tools/skills-config)
- ClawHub installs: [ClawHub](/tools/clawhub)

## Commands

```bash
openclaw skills list
openclaw skills list --eligible
openclaw skills info <name>
openclaw skills check

# Import skill(s) from a git repo or GitHub tree URL
openclaw skills import <source>

# Install into ~/.openclaw/skills (shared across workspaces/agents)
openclaw skills import <source> --managed

# Advanced (optional)
openclaw skills import <source> --ref <branch-or-tag> --subdir <path> --overwrite

# Optional: attempt to auto-install missing dependencies (when the skill declares installers)
openclaw skills import <source> --auto-install
```
