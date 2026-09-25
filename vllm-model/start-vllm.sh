#!/bin/sh
set -eu

: "${HF_HOME:?HF_HOME is required}"
: "${MODEL_FILE:?MODEL_FILE is required}"
: "${MODEL_NAME:?MODEL_NAME is required}"

GGUF_REPO="Qwen/Qwen2.5-Coder-7B-Instruct-GGUF"
MODEL_PATH="${HF_HOME}/${MODEL_FILE}"

mkdir -p "${HF_HOME}"

if [ ! -s "${MODEL_PATH}" ]; then
    echo "Downloading ${MODEL_FILE} from ${GGUF_REPO}"
    hf download "${GGUF_REPO}" \
        --include "${MODEL_FILE}" \
        --local-dir "${HF_HOME}"
fi

if [ ! -s "${MODEL_PATH}" ]; then
    echo "GGUF model is still missing or empty: ${MODEL_PATH}" >&2
    exit 1
fi

ls -lh "${MODEL_PATH}"

cmd = 'vllm serve "${MODEL_PATH}" \
    --tokenizer "${MODEL_NAME}" \
    --hf-config-path "${MODEL_NAME}" \
    --served-model-name "${MODEL_NAME}" \
    --max-model-len 8192 \
    --max-num-seqs 4 \
    --max-num-batched-tokens 8192 \
    --gpu-memory-utilization 0.90 \
    --enforce-eager \
    --enable-auto-tool-choice \
    --tool-call-parser hermes \
    --host 127.0.0.1 \
    --port 9000'

echo "Running command: cmd"

exec cmd