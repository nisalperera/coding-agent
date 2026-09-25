# Pin this in production to a vLLM version validated against your CUDA driver.
FROM vllm/vllm-openai:v0.10.2

ARG HF_HUB_DISABLE_XET=1
ARG HF_HUB_DOWNLOAD_TIMEOUT=300
ARG HF_HUB_ETAG_TIMEOUT=30
ARG HF_HUB_ENABLE_HF_TRANSFER=0
ARG MODEL_NAME=Qwen/Qwen2.5-Coder-7B-Instruct
ARG MODEL_FILE=qwen2.5-coder-7b-instruct-q2_k.gguf

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
    pip install "nvidia-ml-py==13.610.43"

COPY start-vllm.sh /usr/local/bin/start-vllm.sh

RUN chmod +x /usr/local/bin/start-vllm.sh

ENV MODEL_NAME=${MODEL_NAME} \
    MODEL_FILE=${MODEL_FILE}

ENTRYPOINT ["/usr/local/bin/start-vllm.sh"]
