#!/bin/bash
# Moshi personal voice, macOS: Python and the training libraries in ./work (nothing installed system-wide), then train.py.
cd "$(dirname "$0")" || exit 1
set -e
WORK="$PWD/work"
mkdir -p "$WORK"
export UV_PYTHON_INSTALL_DIR="$WORK/python" UV_CACHE_DIR="$WORK/uv-cache" HF_HOME="$WORK/hf" PYTHONUTF8=1
if [ ! -x "$WORK/uv/uv" ]; then
  echo "» Tải uv (cài Python riêng cho việc này) / Getting uv (a private Python for this)"
  curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR="$WORK/uv" UV_NO_MODIFY_PATH=1 sh
fi
"$WORK/uv/uv" venv "$WORK/venv" --python 3.12 --allow-existing
echo "» Cài thư viện huấn luyện (lần đầu vài GB) / Installing the training libraries (a few GB the first time)"
"$WORK/uv/uv" pip install --python "$WORK/venv/bin/python" torch 'transformers>=5.2' peft accelerate safetensors sentencepiece huggingface_hub numpy
"$WORK/venv/bin/python" train.py "$@" || true
echo
read -r -p "Nhấn Enter để đóng / Press Enter to close"
