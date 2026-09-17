#!/bin/sh
set -eu

MODEL_PATH="${HF_HOME}/qwen2.5-coder-14b-instruct-q3_k_m.gguf"

if [ ! -f "${MODEL_PATH}" ]; then
    echo "vLLM model file was not found: ${MODEL_PATH}" >&2
    echo "Place the GGUF file in ./vllm-model/huggingface before starting vLLM." >&2
    exit 1
fi

exec vllm serve "${MODEL_PATH}" \
    --tokenizer Qwen/Qwen2.5-Coder-14B-Instruct \
    --served-model-name qwen2.5-coder-14b \
    --max-model-len 8192 \
    --max-num-seqs 4 \
    --max-num-batched-tokens 8192 \
    --gpu-memory-utilization 0.90 \
    --enforce-eager \
    --host 127.0.0.1 \
    --port 9000