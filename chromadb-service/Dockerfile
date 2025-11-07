# ChromaDB Server Dockerfile for Railway
# Standalone ChromaDB service with persistent storage

FROM python:3.11-slim

# Install ChromaDB and dependencies
RUN pip install --no-cache-dir chromadb==0.4.22

# Create data directory for persistent storage
# Railway will mount a volume here
RUN mkdir -p /chroma/data

# Set working directory
WORKDIR /chroma

# Expose ChromaDB port
EXPOSE 8000

# Environment variables
ENV CHROMA_SERVER_HOST=0.0.0.0
ENV CHROMA_SERVER_HTTP_PORT=8000
ENV PERSIST_DIRECTORY=/chroma/data
ENV IS_PERSISTENT=TRUE
ENV ANONYMIZED_TELEMETRY=FALSE

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD python -c "import requests; requests.get('http://localhost:8000/api/v1/heartbeat')"

# Start ChromaDB server
# --host 0.0.0.0 makes it accessible from outside the container
# --path /chroma/data enables persistent storage
CMD ["chroma", "run", "--host", "0.0.0.0", "--port", "8000", "--path", "/chroma/data"]
