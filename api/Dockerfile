FROM python:3.12-slim

WORKDIR /app

# Dependencies first, so a code change does not re-resolve the solver stack.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Most hosts inject $PORT.
ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
