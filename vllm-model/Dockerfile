# Pin this in production to a vLLM version validated against your CUDA driver.
FROM vllm/vllm-openai:latest

ENV HF_HOME=/root/.cache/huggingface \
    TRANSFORMERS_CACHE=/root/.cache/huggingface \
    TOKENIZERS_PARALLELISM=false \
    PYTHONUNBUFFERED=1

EXPOSE 8000

ENTRYPOINT ["vllm", "serve"]

CMD [\
    "Qwen/Qwen2.5-Coder-14B-Instruct-GPTQ-Int4", \
    "--served-model-name", "qwen2.5-coder-14b", \
    "--quantization", "gptq", \
    "--dtype", "half", \
    "--max-model-len", "32768", \
    "--gpu-memory-utilization", "0.90", \
    "--host", "0.0.0.0", \
    "--port", "8000"\
]