<h1 align="center">TCode</h1>
<p align="center">
  Highly customizable desktop GUI for the <a href="https://www.npmjs.com/package/@earendil-works/pi-coding-agent">Pi coding agent</a> — the same engine as the Pi CLI, in a clean visual interface. Multi-session chat, visual tool approvals, built-in subagents, UI plugins, and custom themes.
</p>
<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="Apache-2.0 License"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22.19-339933?logo=nodedotjs&style=flat-square" alt="Node >=22.19">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue?style=flat-square" alt="macOS | Windows | Linux">
</p>
<p align="center">
  TCode is licensed under <strong>Apache-2.0</strong>. It is a renamed, modified build of <strong>Percho</strong> (MIT License · © 2026 Jaxton07);
  the original author&apos;s attribution and MIT license are kept intact — see <a href="NOTICE">NOTICE</a> / <a href="LICENSE">LICENSE</a>.
</p>
---

## Demo

## Why TCode?

TCode embeds the official Pi SDK (`@earendil-works/pi-coding-agent`) in the Electron main process. It is **not a fork and not a reimplementation** — it runs the same engine as the Pi CLI, so TypeScript extensions, skills and prompt templates written for the Pi CLI work here unchanged, including project-local ones (with a trust prompt before loading). It also shares the same `~/.pi/agent/` directory, so sessions and settings carry over between the CLI and the GUI.

## Features

### Chat and sessions

- Multiple concurrent sessions in one window, each with its own context
- Collapsible project/session sidebar with draggable pinned-session pills
- Per-session composer drafts, so switching sessions never loses what you typed
- Follow-up queue with undo: stage messages while the agent is still working
- Fork a session from an assistant turn or from selected context, and recall your own message back into the composer
- Todo panel and a per-turn diff sidebar
- Slash-command menu and `@`-file completion
- Session archive

### Agent and tools

- Visual permission gates: approve or deny each tool call from a dock, backed by a per-tool rule engine
- Built-in terminal (PTY) with a real shell
- Browser control: let the agent navigate, click, fill in forms and read pages in an embedded browser
- Workspace checkpoints: snapshot and roll back changes
- Context evaporation (on by default): stale tool outputs age into compact stubs, keeping long sessions within budget
- Built-in `show_image` tool for deliberate inline images (single or grouped)
- Streaming markdown rendering, image previews and message copy

### Subagents

- Built-in Explore agent plus your own agent definitions
- Parallel task fan-outs
- Run cards you can click to inspect the sub-session read-only
- Per-assistant model and thinking-depth overrides

### Customization

- Highly customizable UI: swap tool-call cards or extend the settings panel via UI plugins
- Desk-pet overlays (two whale-maid pets ship built in)
- Custom background image with adjustable overlay dimming
- Light, dark and system themes
- Chinese and English interface

### Extensibility

- Pi extensions, skills and prompt templates work unchanged, including project-local ones
- Shared `~/.pi/agent/` configuration with the Pi CLI
- UI plugin API with its own spec, TypeScript typings and examples

### Reliability

- Unified error system: in-chat error cards with one-click retry and an auto-retry status line
- Renderer crash recovery
- In-app update checks (Windows and Linux install in place; macOS opens the Releases page)

### Platform

- macOS (Apple Silicon and Intel), Windows (x64) and Linux (x64)
- Version control and the agent's shell run on a built-in self-contained implementation (no external Git or Git Bash dependency); Windows builds additionally include a system PowerShell terminal
- Node.js >= 22.19 for development
- Reference installers are built and verified for Windows x64. The macOS and Linux targets are configured in `electron-builder.yml`; the per-platform native prebuilds are excluded from the `files` patterns by default.

## Download

Installers are produced by `npm run dist`; the artifacts are named `tcode-*` (see the table below).

| Platform | Download |
| --- | --- |
| macOS (Apple Silicon) | `tcode-mac-arm64.dmg` |
| macOS (Intel) | `tcode-mac-x64.dmg` |
| Windows | `tcode-windows-x64.exe` (installer) or `tcode-windows-x64.zip` |
| Linux (x64) | `tcode-linux-x86_64.AppImage` |

> Builds are ad-hoc signed (no Developer ID certificate). On macOS, the first launch after a download may show **"Apple cannot verify TCode is free from malware"** — that's Gatekeeper blocking an un-notarized app. To open it:
>
> 1. **System Settings → Privacy & Security** → scroll to the bottom → click **Open Anyway** next to the TCode entry, then confirm with your password or Touch ID (recommended).
>
> 2. Or in Terminal: `xattr -cr "/Applications/TCode.app"`.
>
> Updates are checked in-app. On Windows they download and install there too (click download, then restart). On macOS the ad-hoc signed build cannot self-install, so the app jumps to the Releases page — and a freshly downloaded version will hit Gatekeeper once again. On Windows, click "More info" → "Run anyway" when SmartScreen appears.
>
> On Linux: make the AppImage executable before first launch (`chmod +x tcode-linux-x86_64.AppImage`). On Ubuntu 22.04+/24.04+ and derivatives, install `libfuse2` first — AppImages mount via FUSE 2, which is no longer preinstalled. Linux builds download and install updates in-app.

## Development

Prerequisites: **Node.js >= 22.19**.

```bash
npm install
npm run dev
```

npm workspaces monorepo, three packages: `packages/shared` (IPC contracts), `packages/backend` (the only place that imports the Pi SDK), `packages/desktop` (Electron + React 19 + Tailwind 4 + Zustand). Common commands: `npm run typecheck` / `test` / `lint` / `build` / `dist`.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide. If you are in China and the Electron binary download stalls, set `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` first.

## Disclaimer

TCode is a community project. It is **not** built by or affiliated with the Pi team (earendil-works).

## License

Copyright © 2026 YQCC (liassy). Licensed under the [Apache License 2.0](LICENSE).

TCode is a renamed, modified build of Percho, which is licensed under the MIT License. Percho's original MIT notice is kept verbatim at the end of [LICENSE](LICENSE) (see also [NOTICE](NOTICE)). Third-party components keep their own licenses; their full texts ship in `resources/licenses/THIRD-PARTY-LICENSES.txt`. Version control and the shell runtime are built into the bundled runtime component under the same Apache-2.0 license, so no GPL component is bundled.
