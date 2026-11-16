#!/usr/bin/env bash
# One-time Onyx setup on Apple Silicon: installs the local model stack and creates `onyx-qwen`.
# Safe to re-run; every step skips work that is already done.
set -euo pipefail

# Qwen 3.6 35B-A3B as a 3-bit Unsloth quant (13.7 GB). The 23 GB Q4 build left a 32 GB Mac
# swapping while other apps ran. Override with L3_GGUF_URL to use another GGUF.
GGUF_URL="${L3_GGUF_URL:-https://huggingface.co/unsloth/Qwen3.6-35B-A3B-GGUF/resolve/main/Qwen3.6-35B-A3B-UD-IQ3_S.gguf}"
# 128K for Qwen, which caches few layers; must match contextTokens in packages/contracts/src/l3Local.ts.
CONTEXT="${L3_CONTEXT:-131072}"
LAGUNA_CONTEXT="${L3_LAGUNA_CONTEXT:-65536}"
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
# Moves an installed model to a new num_ctx without downloading anything: same weights, new setting.
set_context() {
  local model="$1" want="$2" have modelfile
  have="$(ollama show "$model" --parameters 2>/dev/null | awk '$1 == "num_ctx" { print $2 }')"
  [ "$have" = "$want" ] && return
  echo "==> Setting $model context to $want tokens (was ${have:-unset})"
  modelfile="$(mktemp)"
  ollama show "$model" --modelfile | grep -v '^PARAMETER num_ctx ' >"$modelfile"
  echo "PARAMETER num_ctx $want" >>"$modelfile"
  ollama create "$model" -f "$modelfile"
  rm -f "$modelfile"
}

# Onyx's models were once called l3-coder and l3-laguna; move them to the new names in place.
for pair in l3-coder:onyx-qwen l3-laguna:onyx-laguna; do
  old="${pair%%:*}" new="${pair##*:}"
  if ollama show "$old" >/dev/null 2>&1; then
    ollama show "$new" >/dev/null 2>&1 || ollama cp "$old" "$new"
    ollama rm "$old" >/dev/null
    echo "==> Renamed $old to $new"
  fi
done

if ollama show onyx-qwen >/dev/null 2>&1 && [ "${L3_RECREATE:-0}" != "1" ]; then
  echo "==> onyx-qwen already exists (L3_RECREATE=1 rebuilds it)"
  set_context onyx-qwen "$CONTEXT"
else
  mkdir -p "$MODELS_DIR"
  echo "==> Downloading $(basename "$GGUF") (about 14 GB; resumes if interrupted)"
  # Hugging Face's CDN is several times faster than `ollama pull hf.co/...`.
  curl -fL -C - --retry 5 -o "$GGUF" "$GGUF_URL"

  echo "==> Creating onyx-qwen ($CONTEXT-token context)"
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
  ollama create onyx-qwen -f "$MODELFILE"
  # Ollama keeps its own copy of the weights.
  rm -f "$GGUF"
fi

# Optional second model: Poolside's Laguna XS 2.1 (US), shown in the model picker when installed.
if [ "${L3_WITH_LAGUNA:-0}" = "1" ] && ! ollama show onyx-laguna >/dev/null 2>&1; then
  LAGUNA_URL="https://huggingface.co/bartowski/Laguna-XS-2.1-GGUF/resolve/main/Laguna-XS-2.1-Q3_K_S.gguf"
  LAGUNA_GGUF="$MODELS_DIR/$(basename "$LAGUNA_URL")"
  mkdir -p "$MODELS_DIR"
  echo "==> Downloading $(basename "$LAGUNA_GGUF") (about 15 GB; resumes if interrupted)"
  curl -fL -C - --retry 5 -o "$LAGUNA_GGUF" "$LAGUNA_URL"
  LAGUNA_MODELFILE="$(mktemp)"
  # Poolside's chat format and recommended sampling.
  {
    echo "FROM $LAGUNA_GGUF"
    echo "TEMPLATE {{ .Prompt }}"
    echo "RENDERER poolside-v1"
    echo "PARSER poolside-v1"
    echo "PARAMETER num_ctx $LAGUNA_CONTEXT"
    echo "PARAMETER temperature 1"
    echo "PARAMETER top_k 20"
    echo "PARAMETER top_p 1"
  } >"$LAGUNA_MODELFILE"
  ollama create onyx-laguna -f "$LAGUNA_MODELFILE"
  rm -f "$LAGUNA_MODELFILE" "$LAGUNA_GGUF"
fi

echo "==> Installing Onyx dependencies"
(cd "$ROOT" && pnpm install)

echo
echo "Onyx is ready. Start it with: $ROOT/scripts/l3"
