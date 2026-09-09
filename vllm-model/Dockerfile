# Pin this in production to a vLLM version validated against your CUDA driver.
FROM vllm/vllm-openai:v0.10.2

ENV HF_HOME=/root/.cache/huggingface \
    TRANSFORMERS_CACHE=/root/.cache/huggingface \
    TOKENIZERS_PARALLELISM=true \
    PYTHONUNBUFFERED=1

EXPOSE 9000

RUN python3 -m pip install "huggingface_hub[cli]"

RUN huggingface-cli download Qwen/Qwen2.5-Coder-14B-Instruct-GGUF \
  --include "qwen2.5-coder-14b-instruct-q3_k_m.gguf" \
  --local-dir ${HF_HOME} \
  --local-dir-use-symlinks False


ENTRYPOINT ["vllm", "serve"]

CMD [\
    "${HF_HOME}/Qwen/Qwen2.5-Coder-14B-Instruct-GPTQ-Int4", \
    "--tokenizer", "Qwen/Qwen2.5-Coder-14B-Instruct", \
    "--served-model-name", "qwen2.5-coder-14b", \
    "--max-model-len", "32768", \
    "--gpu-memory-utilization", "0.90", \
    "--host", "0.0.0.0", \
    "--port", "9000"\
]