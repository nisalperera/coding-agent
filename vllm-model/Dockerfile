# Pin this in production to a vLLM version validated against your CUDA driver.
FROM vllm/vllm-openai:v0.10.2

ARG HF_HUB_DISABLE_XET=1
ARG HF_HUB_DOWNLOAD_TIMEOUT=300
ARG HF_HUB_ETAG_TIMEOUT=30
ARG HF_HUB_ENABLE_HF_TRANSFER=0

ENV HF_HOME=/root/.cache/huggingface \
    HF_HUB_DISABLE_XET=${HF_HUB_DISABLE_XET} \
    HF_HUB_DOWNLOAD_TIMEOUT=${HF_HUB_DOWNLOAD_TIMEOUT} \
    HF_HUB_ETAG_TIMEOUT=${HF_HUB_ETAG_TIMEOUT} \
    HF_HUB_ENABLE_HF_TRANSFER=${HF_HUB_ENABLE_HF_TRANSFER} \
    TRANSFORMERS_CACHE=/root/.cache/huggingface \
    TOKENIZERS_PARALLELISM=true \
    PYTHONUNBUFFERED=1

EXPOSE 9000

RUN python3 -m pip install "huggingface_hub[cli]"

RUN pip uninstall -y pynvml && \
    pip install --no-cache-dir "nvidia-ml-py==13.610.43"

# RUN huggingface-cli download Qwen/Qwen2.5-Coder-14B-Instruct-GGUF \
#   --include "qwen2.5-coder-14b-instruct-q3_k_m.gguf" \
#   --local-dir ${HF_HOME} \
#   --local-dir-use-symlinks False
COPY start-vllm.sh /usr/local/bin/start-vllm.sh

RUN chmod +x /usr/local/bin/start-vllm.sh

ENTRYPOINT ["/usr/local/bin/start-vllm.sh"]

# ENTRYPOINT ["sh", "-c"]
# CMD ["exec vllm serve \"${HF_HOME}/qwen2.5-coder-14b-instruct-q3_k_m.gguf\" --tokenizer Qwen/Qwen2.5-Coder-14B-Instruct --served-model-name qwen2.5-coder-14b --max-model-len 32768 --gpu-memory-utilization 0.90 --host 0.0.0.0 --port 9000"]
# ENTRYPOINT ["vllm", "serve"]

# CMD [\
#     "${HF_HOME}/Qwen/Qwen2.5-Coder-14B-Instruct-GPTQ-Int4", \
#     "--tokenizer", "Qwen/Qwen2.5-Coder-14B-Instruct", \
#     "--served-model-name", "qwen2.5-coder-14b", \
#     "--max-model-len", "32768", \
#     "--gpu-memory-utilization", "0.90", \
#     "--host", "0.0.0.0", \
#     "--port", "9000"\
# ]