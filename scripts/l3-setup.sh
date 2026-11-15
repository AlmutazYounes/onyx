#!/usr/bin/env bash
# One-time L3 setup on Apple Silicon: installs the local model stack and creates `l3-coder`.
# Safe to re-run; every step skips work that is already done.
set -euo pipefail

# Qwen 3.6 35B-A3B as a 3-bit Unsloth quant (13.7 GB). The 23 GB Q4 build left a 32 GB Mac
# swapping while other apps ran. Override with L3_GGUF_URL to use another GGUF.
GGUF_URL="${L3_GGUF_URL:-https://huggingface.co/unsloth/Qwen3.6-35B-A3B-GGUF/resolve/main/Qwen3.6-35B-A3B-UD-IQ3_S.gguf}"
CONTEXT="${L3_CONTEXT:-65536}"
MODELS_DIR="$HOME/.l3/models"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

need() { command -v "$1" >/dev/null 2>&1; }

if ! need brew; then
  echo "Homebrew is required: https://brew.sh" >&2
  exit 1
fi

for pkg in ollama opencode node; do
  if ! brew list --formula "$pkg" >/dev/null 2>&1; then
    echo "==> Installing $pkg"
    brew install "$pkg"
  fi
done

NODE_BIN="$(brew --prefix node)/bin"
export PATH="$NODE_BIN:$(brew --prefix)/bin:$PATH"
if ! need pnpm || [ "$(pnpm -v 2>/dev/null)" != "12.14.0" ]; then
  npm i -g pnpm@12.14.0
fi

echo "==> Starting Ollama as a login service"
brew services start ollama >/dev/null
for _ in $(seq 1 30); do
  curl -fs http://127.0.0.1:11434/api/version >/dev/null && break
  sleep 1
done

GGUF="$MODELS_DIR/$(basename "$GGUF_URL")"
if ollama show l3-coder >/dev/null 2>&1 && [ "${L3_RECREATE:-0}" != "1" ]; then
  echo "==> l3-coder already exists (L3_RECREATE=1 rebuilds it)"
else
  mkdir -p "$MODELS_DIR"
  echo "==> Downloading $(basename "$GGUF") (about 14 GB; resumes if interrupted)"
  # Hugging Face's CDN is several times faster than `ollama pull hf.co/...`.
  curl -fL -C - --retry 5 -o "$GGUF" "$GGUF_URL"

  echo "==> Creating l3-coder ($CONTEXT-token context)"
  MODELFILE="$(mktemp)"
  trap 'rm -f "$MODELFILE"' EXIT
  # RENDERER/PARSER select Ollama's built-in Qwen 3.5/3.6 chat format, which carries tool calls.
  {
    echo "FROM $GGUF"
    echo "TEMPLATE {{ .Prompt }}"
    echo "RENDERER qwen3.5"
    echo "PARSER qwen3.5"
    echo "PARAMETER num_ctx $CONTEXT"
    echo "PARAMETER temperature 0.6"
    echo "PARAMETER top_p 0.95"
    echo "PARAMETER top_k 20"
    echo "PARAMETER min_p 0"
    echo "PARAMETER repeat_penalty 1"
  } >"$MODELFILE"
  ollama create l3-coder -f "$MODELFILE"
  # Ollama keeps its own copy of the weights.
  rm -f "$GGUF"
fi

echo "==> Installing L3 dependencies"
(cd "$ROOT" && pnpm install)

echo
echo "L3 is ready. Start it with: $ROOT/scripts/l3"
