ARG LITELLM_IMAGE=ghcr.io/berriai/litellm:v1.83.14-stable
FROM ${LITELLM_IMAGE}

COPY config.yaml /app/config.yaml

CMD ["--config", "/app/config.yaml", "--port", "4000"]
