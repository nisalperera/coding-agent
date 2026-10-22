#!/bin/sh
set -eu


: "${HF_HOME:?HF_HOME is required}"
: "${MODEL_FILE?MODEL_FILE is required}"
: "${MODEL_NAME:?MODEL_NAME is required}"


MODEL_PATH="${HF_HOME}/${MODEL_FILE}"


mkdir -p "${HF_HOME}"


if [ -n "${MODEL_FILE}" ]; then
    if [ ! -s "${MODEL_PATH}" ]; then
        echo "Downloading ${MODEL_FILE} from ${MODEL_NAME} to ${HF_HOME}..."


        hf download "${MODEL_NAME}" \
            --include "${MODEL_FILE}" \
            --local-dir "${HF_HOME}"
    fi


    if [ ! -s "${MODEL_PATH}" ]; then
        echo "GGUF model is still missing or empty: ${MODEL_PATH}" >&2
        exit 1
    fi
else
    MODEL_PATH="${MODEL_NAME}"
fi


set -- vllm serve "${MODEL_PATH}" \
    --tokenizer "${MODEL_NAME}" \
    --hf-config-path "${MODEL_NAME}" \
    --served-model-name "${MODEL_NAME}" \
    --max-model-len 8192 \
    --max-num-seqs 4 \
    --max-num-batched-tokens 8192 \
    --gpu-memory-utilization 0.70 \
    --enforce-eager \
    --enable-auto-tool-choice \
    --tool-call-parser hermes \
    --reasoning-parser qwen3 \
    --host 127.0.0.1 \
    --port 9000


printf 'Running command:'
printf ' <%s>' "$@"
printf '\n'


exec "$@"
