# pdf-worker: único serviço em Python (MarkItDown, pdfplumber e OCR com Tesseract).
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-por && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY leitura.py servidor.py ./
ENV PORTA=8001
EXPOSE 8001
CMD ["python", "servidor.py"]
