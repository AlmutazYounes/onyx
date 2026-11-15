# L3

**L3 is T3 Code rewired to run entirely on a local model.** No subscriptions, no API keys, and
your prompts and code stay on your Mac.

T3 Code is only a control panel, so it needs a coding agent to do the work. L3 ships preconfigured
with [OpenCode](https://opencode.ai) as that agent. OpenCode talks to a model served by
[Ollama](https://ollama.com) on `127.0.0.1:11434`.

| Piece           | What L3 uses                                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Model           | Qwen 3.6 35B-A3B, Unsloth `UD-IQ3_S` GGUF (13.7 GB, MoE, ~3B active per token), wrapped as `l3-coder` with 64K context |
| Model server    | Ollama (Metal), started as a login service                                                                             |
| Agent / harness | OpenCode 2 with its own database (`~/.l3/opencode`), limited to the local `l3` provider                                |
| Titles, commits | Text generator `l3-local` → the same Ollama endpoint                                                                   |
| Data directory  | `~/.l3` (kept apart from any T3 Code install in `~/.t3`)                                                               |
| Telemetry       | Off by default (`T3CODE_TELEMETRY_ENABLED=true` turns it back on)                                                      |
| Auto-update     | Off (desktop updater and `t3` self-update), so T3 Code releases can't replace L3                                       |

The model is sized for a 32 GB Apple Silicon Mac that also runs a browser, an editor and chat apps.
The 4-bit build (`qwen3.6:35b-a3b`, 23 GB) fits on paper, but in practice it pushed the Mac into swap.
The 3-bit build leaves about 10 GB free for everything else. The mixture-of-experts design keeps it
fast, because only about 3B parameters run per token. To try another GGUF, point `L3_GGUF_URL` at
it and run `L3_RECREATE=1 scripts/l3-setup.sh`. On a Mac with 48 GB or more, the 4-bit
`Qwen3.6-35B-A3B-UD-Q4_K_M.gguf` from the same Unsloth repository is a step up.

Measured on an M6 Mac mini with 32 GB: about 53 tokens/s generation, about 970 tokens/s prompt
reading (an agent's first turn waits about 10 s for its system prompt), 100% on the GPU, no swap growth.

The thread details panel (right side, under the machine name) shows live CPU, RAM and GPU load and
the model's tokens per second. L3 measures speed with a small loopback proxy between OpenCode and
Ollama.

## Use L3

```bash
scripts/l3-setup.sh   # once: Ollama, OpenCode, Node, the model, and dependencies
scripts/l3            # build if needed, then start L3 and open it in the browser
```

L3 listens on port 3873, so it can run beside T3 Code (3773). Run either the desktop app or
`scripts/l3`, not both: they share `~/.l3` and its port.

### Desktop app

```bash
RUSTUP_TOOLCHAIN=1.95 PATH="$PWD/node_modules/.bin:$PATH" \
  node scripts/build-desktop-artifact.ts --platform mac --target dmg --arch arm64
```

This writes `release/L3-<version>-arm64.dmg`. The build is unsigned, so the first time you open
L3.app, right-click it and choose **Open**.

Codex and Claude are still available under **Settings → Providers** if you want to turn them on.

---

<p align="center">
  <a href="https://t3.codes">
    <img src="./assets/prod/t3-black-web-icon-192x192.png" width="80" height="80" alt="T3 Code logo" />
  </a>
</p>

<h1 align="center">T3 Code</h1>

<p align="center">The open-source control plane for coding agents.</p>

<p align="center">
  <a href="https://t3.codes/download"><strong>Download</strong></a> ·
  <a href="https://apps.apple.com/us/app/t3-code-remote-claude-more/id6787819824">iOS</a> ·
  <a href="https://play.google.com/store/apps/details?id=com.t3tools.t3code">Android</a> ·
  <a href="https://app.t3.codes">Web</a> ·
  <a href="./docs/README.md">Docs</a> ·
  <a href="https://discord.gg/jn4EGJjrvv">Discord</a>
</p>

<p align="center">
  <a href="https://t3.codes">
    <img src="./.github/readme/hero.webp" width="100%" alt="T3 Code on desktop with a finished Claude thread, next to the phone app asking to approve a command from Codex" />
  </a>
</p>

T3 Code runs the coding agents on your machine and gives them one fast interface. Start a thread at your desk, then approve the next step from your phone.

It works with Claude Code, Codex, Cursor, OpenCode, Grok Build, Antigravity, Kiro, Pi, Muse Code, fx, and any [ACP](./docs/user/providers-acp.md) agent. If an agent is set up on your computer, T3 Code can control it.

## What you get

- **Your subscriptions.** T3 Code does not resell tokens. It drives the agents you are already signed in to.
- **Every agent in one place.** Change models in the middle of a thread. Let Claude hand a task to Codex.
- **Desktop, web, and phone.** One server, and every client shows the same threads. There are apps for iOS and Android.
- **Remote ready.** Run agents on any machine. Connect over your local network, Tailscale, or [T3 Connect](./docs/user/remote-access.md).
- **Git built in.** Each thread can work in its own worktree. Review the diff, then commit, push, and open a pull request with one button.
- **Fast.** Performance is a feature here. We measure it, and we treat a dropped frame as a bug.
- **Open.** MIT licensed. If you don't like something, fork it.

## Install

### Desktop app

[Download T3 Code](https://t3.codes/download) for macOS, Windows, or Linux. You can also use a package manager:

| Platform       | Command                                                              |
| -------------- | -------------------------------------------------------------------- |
| macOS          | `brew install --cask t3-code`                                        |
| Windows        | `winget install T3Tools.T3Code` or `scoop install extras/t3code`     |
| Arch Linux     | `yay -S t3code-bin`                                                  |
| Nix            | `nix profile add github:NixOS/nixpkgs/nixos-unstable#t3code`         |
| Debian, Ubuntu | `.deb` from [Releases](https://github.com/pingdotgg/t3code/releases) |

### Command line

This installs the `t3` command. Run `t3` to start the server and open the web app.

```bash
curl -fsSL https://t3.codes/install.sh | sh
```

On Windows, in PowerShell:

```powershell
irm https://t3.codes/install.ps1 | iex
```

To try it once without an install, run `npx t3@latest`.

### Phone

Get the app from the [App Store](https://apps.apple.com/us/app/t3-code-remote-claude-more/id6787819824) or [Google Play](https://play.google.com/store/apps/details?id=com.t3tools.t3code). Then follow [remote access](./docs/user/remote-access.md) to connect it to your computer.

### Sign in to an agent

T3 Code needs one agent that is installed and signed in. For example, install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`, or install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`.

[Provider setup](./docs/user/install.md#providers) has the steps for each agent. [Install T3 Code](./docs/user/install.md) covers nightly builds, AppImage, WSL, and NixOS.

## "Wait, what are you selling me?"

Nothing. We built T3 Code because we wanted the best possible development experience with agents. We were inspired by existing solutions like the Codex desktop app, Conductor, Claude Desktop and Cursor Glass, but none met our bar.

We wanted something performant, remote-ready, and truly open. If we ever go the wrong direction, we want you to have everything you need to fork and build the tool that you want.

## Documentation

- [Install and first run](./docs/user/install.md)
- [Remote access from a phone or another machine](./docs/user/remote-access.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Source control](./docs/user/source-control.md)
- [Connect outside agents over MCP](./docs/user/outside-agents.md)
- [FAQ](./docs/user/faq.md)

[All docs](./docs/README.md) has the full list.

## Contributing

We have limited review capacity. Small, focused fixes are the most likely to be merged. Features need an approved discussion first.

- Read [CONTRIBUTING.md](./CONTRIBUTING.md) before you report a bug or open a pull request.
- Put feature requests in [Ideas](https://github.com/pingdotgg/t3code/discussions/categories/ideas).
- Build from source with the [development runbook](./docs/operations/development.md#first-checkout). The [architecture overview](./docs/internals/overview.md) explains how it works.
- Get help in [Discord](https://discord.gg/jn4EGJjrvv).

## License

[MIT](./LICENSE)
