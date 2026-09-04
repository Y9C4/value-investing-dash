FROM python:3.12-slim

WORKDIR /app

# Dependencies first, so a code change does not re-resolve the solver stack.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Nothing here needs root, and a container that runs as root is a container
# whose every dependency runs as root.
RUN useradd --create-home --uid 10001 margin && chown -R margin:margin /app
USER margin

# Most hosts inject $PORT.
ENV PORT=8000
EXPOSE 8000

# One worker on purpose. A solve is CPU-bound and the price cache is
# per-process, so a second worker would double the memory and halve the cache
# hit rate for no extra throughput on two vCPUs. Concurrency is bounded at the
# platform instead (`--concurrency` on Cloud Run).
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT} --workers 1"]
