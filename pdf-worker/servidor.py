"""API HTTP interna do pdf-worker (só o backend chama; não exponha esta porta).

Rotas:
  GET  /saude
  POST /analisar-edital   corpo: PDF  -> conversão, partes, tabelas de itens, metadados, esqueleto, capítulos
  POST /analisar-proposta corpo: PDF  -> conversão (páginas + células), texto mascarado, OCR quando preciso
  POST /mascarar          corpo: JSON {"texto": "..."}
"""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import leitura

LIMITE_BYTES = int(os.getenv("MAX_PDF_MB", "25")) * 1024 * 1024
OCR_ATIVO = os.getenv("OCR_ATIVO", "true").lower() == "true"
OCR_IDIOMA = os.getenv("OCR_IDIOMA", "por")


def analisar_edital(pdf):
    conv = leitura.converter(pdf)
    linhas = leitura._linhas(pdf)  # layout lido uma vez só
    return {
        "conversao": conv,
        "partes": leitura.partes(pdf, linhas),
        "tabelas_itens": leitura.tabelas_de_itens(pdf),
        "metadados": leitura.metadados(conv["markdown"]),
        "esqueleto": leitura.esqueleto(pdf, linhas),
        "capitulos": leitura.capitulos(pdf, linhas),
    }


def analisar_proposta(pdf):
    conv = leitura.converter(pdf)
    if OCR_ATIVO and conv["paginas_sem_texto"]:
        try:
            for o in leitura.ocr(pdf, conv["paginas_sem_texto"], OCR_IDIOMA):
                pagina = conv["paginas"][o["pagina"] - 1]
                pagina["texto"] = o["texto"]
                pagina["ocr"] = True
        except Exception as erro:  # OCR é complemento: falha não derruba a leitura
            conv["erro_ocr"] = str(erro)
    texto = "\n\n".join(f"[página {p['pagina']}]\n{p['texto']}" for p in conv["paginas"])
    mascarado, contagem = leitura.mascarar(texto)
    celulas_mascaradas = [{"pagina": c["pagina"], "texto": leitura.mascarar(c["texto"])[0]} for c in conv["celulas"]]
    return {"conversao": conv, "texto": texto, "texto_mascarado": mascarado,
            "celulas_mascaradas": celulas_mascaradas, "lgpd": contagem}


class Manipulador(BaseHTTPRequestHandler):
    def _responder(self, status, corpo):
        dados = json.dumps(corpo, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(dados)))
        self.end_headers()
        self.wfile.write(dados)

    def do_GET(self):
        if self.path == "/saude":
            return self._responder(200, {"status": "ok"})
        self._responder(404, {"erro": "rota não encontrada"})

    def do_POST(self):
        tamanho = int(self.headers.get("Content-Length") or 0)
        if tamanho <= 0 or tamanho > LIMITE_BYTES:
            return self._responder(413, {"erro": "arquivo vazio ou acima do limite"})
        corpo = self.rfile.read(tamanho)
        try:
            if self.path == "/mascarar":
                texto, contagem = leitura.mascarar(json.loads(corpo)["texto"])
                return self._responder(200, {"texto": texto, "lgpd": contagem})
            if not corpo.startswith(b"%PDF-"):
                return self._responder(400, {"erro": "o arquivo enviado não é um PDF"})
            if self.path == "/analisar-edital":
                return self._responder(200, analisar_edital(corpo))
            if self.path == "/analisar-proposta":
                return self._responder(200, analisar_proposta(corpo))
            self._responder(404, {"erro": "rota não encontrada"})
        except Exception as erro:
            self._responder(500, {"erro": f"falha ao ler o PDF: {erro}"})

    def log_message(self, formato, *args):  # log curto no terminal
        print("[pdf-worker]", formato % args)


if __name__ == "__main__":
    porta = int(os.getenv("PORTA", "8001"))
    print(f"pdf-worker ouvindo na porta {porta}")
    ThreadingHTTPServer(("0.0.0.0", porta), Manipulador).serve_forever()
