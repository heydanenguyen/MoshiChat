# Moshi personal voice, Windows: Python and the training libraries in .\work (nothing installed system-wide), then train.py.
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$work = Join-Path $PSScriptRoot 'work'
$uvDir = Join-Path $work 'uv'
$uv = Join-Path $uvDir 'uv.exe'
$env:UV_PYTHON_INSTALL_DIR = Join-Path $work 'python'
$env:UV_CACHE_DIR = Join-Path $work 'uv-cache'
$env:HF_HOME = Join-Path $work 'hf'
$env:PYTHONUTF8 = '1'

if (-not (Test-Path -LiteralPath $uv)) {
  Write-Host '» Tải uv (cài Python riêng cho việc này) / Getting uv (a private Python for this)'
  New-Item -ItemType Directory -Force -Path $uvDir | Out-Null
  $env:UV_INSTALL_DIR = $uvDir
  $env:UV_NO_MODIFY_PATH = '1'
  Invoke-RestMethod 'https://astral.sh/uv/install.ps1' | Invoke-Expression
}

$venv = Join-Path $work 'venv'
$py = Join-Path $venv 'Scripts\python.exe'
& $uv venv $venv --python 3.12 --allow-existing
if ($LASTEXITCODE -ne 0) { throw 'uv venv failed' }

Write-Host '» Cài thư viện huấn luyện (lần đầu vài GB) / Installing the training libraries (a few GB the first time)'
if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
  # CUDA 12.6 builds still include older cards (GTX 10xx)
  & $uv pip install --python $py torch --index-url 'https://download.pytorch.org/whl/cu126'
} else {
  & $uv pip install --python $py torch
}
if ($LASTEXITCODE -ne 0) { throw 'installing torch failed' }
& $uv pip install --python $py 'transformers>=5.2' peft accelerate safetensors sentencepiece huggingface_hub numpy bitsandbytes
if ($LASTEXITCODE -ne 0) { throw 'installing the libraries failed' }

& $py (Join-Path $PSScriptRoot 'train.py') @args
if ($LASTEXITCODE -ne 0) { throw 'training failed' }
