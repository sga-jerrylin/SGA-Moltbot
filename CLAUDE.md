# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- **Install**: `pnpm install`
- **Build Core**: `pnpm build` (compiles TS to `dist/`)
- **Build UI**: `pnpm ui:build`
- **Dev (Gateway)**: `pnpm gateway:watch` (auto-reloads on changes)
- **Dev (UI)**: `pnpm ui:dev`
- **Run CLI**: `pnpm openclaw <command>` (uses `tsx` for development)
- **Run Production**: `pnpm start` or `node scripts/run-node.mjs`
- **Lint**: `pnpm lint` (oxlint with type-aware rules)
- **Format**: `pnpm format` (oxfmt)
- **Type Check**: `tsc -p tsconfig.json --noEmit`

## Testing

- **All Tests**: `pnpm test` (runs unit, e2e, live, and docker tests in parallel)
- **Unit Tests**: `npx vitest` or `pnpm test:watch`
- **Single Test**: `npx vitest path/to/file` or `npx vitest -t "test name"`
- **E2E Tests**: `pnpm test:e2e`
- **Live Tests**: `pnpm test:live` (requires `OPENCLAW_LIVE_TEST=1`)
- **Docker Tests**: `pnpm test:docker:all` (integration tests for gateway, plugins, onboarding)
- **Coverage**: `pnpm test:coverage`

## Native Apps

- **iOS**: `pnpm ios:run` (requires Xcode, xcodegen)
- **Android**: `pnpm android:run` (requires Android SDK, Gradle)
- **macOS**: `pnpm mac:package` then `pnpm mac:open`

## Architecture Overview

OpenClaw is a personal AI assistant ecosystem built on Node.js (>=22) and TypeScript (ESM).

### Core Components
- **Gateway** (`src/gateway/`): WebSocket control plane handling configuration, sessions, channel connections, tool routing, and serves the UI.
- **Agents** (`src/agents/`): The "brain" logic (Pi agent) operating in RPC mode. Model provider configuration lives here.
- **Providers** (`src/providers/`): Model provider abstraction layer (Anthropic, OpenAI, Bedrock, Ollama, etc.).
- **Channels** (`src/channels/`): Adapters for messaging platforms (WhatsApp, Telegram, Discord, Slack, Signal, iMessage, etc.).
- **Config** (`src/config/`): Zod schemas (`zod-schema.*.ts`) for configuration validation and TypeBox types.
- **Commands** (`src/commands/`): CLI command implementations including onboarding wizard.
- **UI** (`ui/`): Web dashboard and chat interface (Lit/WebComponents), served by Gateway.
- **Apps** (`apps/`): Native wrappers for macOS, iOS, Android.
- **Extensions** (`extensions/`): External channel integrations (BlueBubbles, Matrix, Teams, Zalo).

### Key Concepts
- **Sessions**: Isolated conversation contexts. `main` is the primary user session; others are for groups/channels.
- **Nodes**: Device capabilities (camera, screen, system control) exposed to Gateway via WebSocket.
- **Sandboxing**: Non-main sessions can run in Docker containers for security.
- **Skills**: Agent capabilities defined in `~/.openclaw/workspace/skills/<skill>/SKILL.md`.

### Configuration
- User config: `~/.openclaw/openclaw.json` (JSON5 supported)
- Workspace: `~/.openclaw/workspace/` with `AGENTS.md`, `SOUL.md`, `TOOLS.md`
- Credentials: `~/.openclaw/credentials/` (channel auth data)
