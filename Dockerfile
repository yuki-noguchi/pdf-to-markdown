FROM python:3.12-slim

# 基本ツール
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    bash \
    nodejs \
    npm \
  && rm -rf /var/lib/apt/lists/*

# Python依存（PDF → PNG）
RUN pip install --no-cache-dir pymupdf

# Codex CLI
RUN npm install -g @openai/codex

WORKDIR /work

COPY entrypoint.sh /work/entrypoint.sh
COPY run.sh /work/run.sh
COPY pdf2png.py /work/pdf2png.py

RUN chmod +x /work/entrypoint.sh /work/run.sh

ENTRYPOINT ["/work/entrypoint.sh"]
