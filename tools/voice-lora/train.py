"""
Moshi personal voice: a small LoRA trained on your own replies, on this computer.

Reads data/train.jsonl and meta.json (written by Moshi: Settings > AI > Your voice > Export), fine-tunes the MLP
layers of the base Qwen3.5 model a little, converts the result to GGUF with llama.cpp's converter and copies it
where Moshi looks for it. Nothing leaves this computer except the downloads (the base model from Hugging Face,
llama.cpp's converter from GitHub).

Run it through run-windows.cmd or run-mac.command, which set up Python first.
"""
from __future__ import annotations

import argparse
import io
import json
import math
import os
import random
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
LLAMA_CPP_TAG = "v0.5.0"
# Only the MLP: enough to learn a voice, light to train, and simple to carry over to llama.cpp.
TARGET = r".*layers\.\d+\.mlp\.(gate_proj|up_proj|down_proj)$"


def say(vi: str, en: str) -> None:
    print(f"\n» {vi}\n  {en}", flush=True)


def load_samples(path: Path) -> list[dict]:
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    return [r for r in rows if r.get("messages") and r["messages"][-1]["role"] == "assistant"]


def pick_device():
    import torch

    if torch.cuda.is_available():
        major, _ = torch.cuda.get_device_capability(0)
        vram = torch.cuda.get_device_properties(0).total_memory / 2**30
        name = torch.cuda.get_device_name(0)
        # bf16 from Ampere on; fp16 math is slow on Pascal (GTX 10xx), so it stays in fp32 there.
        compute = torch.bfloat16 if major >= 8 else torch.float16 if major >= 7 else torch.float32
        return "cuda", compute, f"{name}, {vram:.0f} GB", vram
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps", torch.bfloat16, "Apple GPU (Metal)", 0.0
    return "cpu", torch.float32, "CPU", 0.0


def load_model(base: str, device: str, compute, vram: float):
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(base)
    kwargs: dict = {"low_cpu_mem_usage": True}
    if device == "cuda":
        # 4-bit base weights (QLoRA): fits a 4B model in under 4 GB of VRAM, a 9B one in about 7.
        from transformers import BitsAndBytesConfig

        kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_use_double_quant=True,
            bnb_4bit_compute_dtype=compute,
        )
        kwargs["device_map"] = {"": 0}
        kwargs["dtype"] = compute if compute != torch.float32 else torch.float16
    else:
        kwargs["dtype"] = compute
    model = AutoModelForCausalLM.from_pretrained(base, **kwargs)
    if device == "mps":
        model.to("mps")
    return model, tokenizer


def encode(tokenizer, sample: dict, max_len: int):
    """Tokens of the whole chat, and labels that only count the reply (the user's own message)."""
    messages = sample["messages"]
    kw = {"enable_thinking": False}
    prompt = tokenizer.apply_chat_template(messages[:-1], tokenize=False, add_generation_prompt=True, **kw)
    full = tokenizer.apply_chat_template(messages, tokenize=False, **kw)
    if not full.startswith(prompt):
        return None
    p = tokenizer(prompt, add_special_tokens=False)["input_ids"]
    f = tokenizer(full, add_special_tokens=False)["input_ids"]
    if len(f) <= len(p):
        return None
    if len(f) > max_len:
        # keep the end: the reply and as much chat before it as fits
        cut = len(f) - max_len
        if cut >= len(p):
            return None
        p, f = p[cut:], f[cut:]
    labels = [-100] * len(p) + f[len(p):]
    return f, labels


def fetch_converter(work: Path) -> Path:
    """llama.cpp's LoRA converter (convert_lora_to_gguf.py, conversion/, gguf-py/) from its release on GitHub."""
    dest = work / f"llama.cpp-{LLAMA_CPP_TAG}"
    if (dest / "convert_lora_to_gguf.py").exists():
        return dest
    url = f"https://codeload.github.com/ggml-org/llama.cpp/tar.gz/refs/tags/{LLAMA_CPP_TAG}"
    data = urllib.request.urlopen(url, timeout=120).read()
    keep = ("convert_lora_to_gguf.py", "convert_hf_to_gguf.py", "conversion/", "gguf-py/")
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        for member in tar.getmembers():
            parts = member.name.split("/", 1)
            if len(parts) < 2 or not parts[1].startswith(keep):
                continue
            member.name = parts[1]
            tar.extract(member, dest, filter="data")
    return dest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=float, default=0, help="0: chosen from the number of samples")
    parser.add_argument("--rank", type=int, default=16)
    parser.add_argument("--lr", type=float, default=2e-4)
    parser.add_argument("--max-len", type=int, default=384)
    parser.add_argument("--limit", type=int, default=0, help="train on at most this many samples (0: all)")
    parser.add_argument("--no-install", action="store_true", help="do not copy the result into Moshi")
    args = parser.parse_args()

    meta = json.loads((HERE / "meta.json").read_text(encoding="utf-8"))
    base = meta["base"]
    samples = load_samples(HERE / "data" / "train.jsonl")
    random.Random(7).shuffle(samples)
    if args.limit:
        samples = samples[: args.limit]
    if len(samples) < 50:
        say(f"Chỉ có {len(samples)} mẫu, cần ít nhất 50. Nhắn thêm một thời gian rồi xuất lại.",
            f"Only {len(samples)} samples; at least 50 are needed. Chat a while longer and export again.")
        sys.exit(1)

    import torch
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training

    device, compute, label, vram = pick_device()
    say(f"Máy: {label}. Mô hình gốc: {base}. Số mẫu: {len(samples)}.",
        f"Machine: {label}. Base model: {base}. Samples: {len(samples)}.")
    if device == "cpu":
        say("Không thấy GPU: chạy bằng CPU sẽ rất lâu (nhiều giờ).", "No GPU found: training on the CPU takes many hours.")

    say("Tải và nạp mô hình gốc (lần đầu tải vài GB)…", "Downloading and loading the base model (a few GB the first time)…")
    model, tokenizer = load_model(base, device, compute, vram)
    if device == "cuda":
        model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)
    else:
        model.gradient_checkpointing_enable()
        model.enable_input_require_grads()
    model.config.use_cache = False
    model = get_peft_model(model, LoraConfig(r=args.rank, lora_alpha=args.rank * 2, lora_dropout=0.05, target_modules=TARGET, task_type="CAUSAL_LM"))
    model.print_trainable_parameters()

    encoded = [e for e in (encode(tokenizer, s, args.max_len) for s in samples) if e]
    if not encoded:
        raise SystemExit("No usable samples after tokenizing")
    # 1-2 passes: enough for a voice; more and it starts reciting your messages word for word
    epochs = args.epochs or max(1.0, min(2.0, 2000 / len(encoded)))
    steps_per_epoch = math.ceil(len(encoded) / 8)
    total = max(1, int(steps_per_epoch * epochs))
    params = [p for p in model.parameters() if p.requires_grad]
    optim = torch.optim.AdamW(params, lr=args.lr, weight_decay=0.0)
    sched = torch.optim.lr_scheduler.LambdaLR(optim, lambda s: min(1.0, (s + 1) / 20) * max(0.05, 1 - s / total))
    run_device = next(model.parameters()).device
    say(f"Huấn luyện: {total} bước ({epochs:.1f} lượt).", f"Training: {total} steps ({epochs:.1f} passes).")

    model.train()
    order = []
    step = 0
    started = time.time()
    while step < total:
        if not order:
            order = list(range(len(encoded)))
            random.shuffle(order)
        loss_sum = 0.0
        tokens = 0
        for _ in range(8):  # 8 samples per step, one at a time (memory stays flat)
            if not order:
                break
            ids, labels = encoded[order.pop()]
            x = torch.tensor([ids], device=run_device)
            y = torch.tensor([labels], device=run_device)
            with torch.autocast(device_type=run_device.type, dtype=compute, enabled=compute != torch.float32 and run_device.type != "cpu"):
                out = model(input_ids=x, labels=y)
            (out.loss / 8).backward()
            loss_sum += out.loss.item()
            tokens += 1
        torch.nn.utils.clip_grad_norm_(params, 1.0)
        optim.step()
        sched.step()
        optim.zero_grad(set_to_none=True)
        step += 1
        if step == 1 or step % 10 == 0 or step == total:
            spent = time.time() - started
            left = spent / step * (total - step)
            print(f"  {step}/{total}  loss {loss_sum / max(1, tokens):.3f}  ~{left / 60:.0f} min left", flush=True)

    work = HERE / "work"
    adapter = work / "adapter"
    model.save_pretrained(adapter)

    say("Chuyển sang định dạng của Moshi (GGUF)…", "Converting to Moshi's format (GGUF)…")
    converter = fetch_converter(work)
    from huggingface_hub import snapshot_download

    base_dir = snapshot_download(base, allow_patterns=["*.json", "*.txt", "*.model", "*.jinja"])
    out = work / f"moshi-voice-{meta['model']}.gguf"
    env = {**os.environ, "PYTHONPATH": str(converter / "gguf-py") + os.pathsep + str(converter)}
    subprocess.run([sys.executable, str(converter / "convert_lora_to_gguf.py"), str(adapter), "--base", base_dir, "--outtype", "f16", "--outfile", str(out)], check=True, env=env)

    if not args.no_install and meta.get("installTo"):
        target = Path(meta["installTo"])
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(out, target)
        say(f"Xong. Moshi sẽ dùng giọng riêng của bạn từ lần gợi ý tới ({target}).",
            f"Done. Moshi uses your voice from the next suggestion ({target}).")
    else:
        say(f"Xong: {out}", f"Done: {out}")


if __name__ == "__main__":
    main()
