"""Leitura de PDFs de licitação.

Único trecho da aplicação em Python: as bibliotecas que funcionaram nos testes com documentos
reais (MarkItDown, pdfplumber e Tesseract) são de Python. Nada aqui usa IA.
"""
import io
import re
import unicodedata

import pdfplumber

try:
    from markitdown import MarkItDown
    _markitdown = MarkItDown()
except Exception:  # MarkItDown é opcional: sem ele, o texto vem do pdfplumber
    _markitdown = None

RODAPE = re.compile(r"^\s*(\d+\s+de\s+\d+|.*\bpg\.\s*\d+\s*)$", re.I)


def normalizar(texto):
    """Normaliza para comparação: sem acento, maiúsculo e com espaços simples."""
    t = unicodedata.normalize("NFKD", texto or "")
    t = "".join(c for c in t if not unicodedata.combining(c))
    t = t.replace("“", '"').replace("”", '"').replace("’", "'")
    return re.sub(r"\s+", " ", t).strip().upper()


# ---------------------------------------------------------------- conversão
def converter(pdf_bytes):
    """Texto por página, células de tabelas, Markdown e páginas sem texto (candidatas a OCR)."""
    paginas, celulas, sem_texto = [], [], []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for i, p in enumerate(pdf.pages, start=1):
            texto = p.extract_text() or ""
            paginas.append({"pagina": i, "texto": texto, "imagens": len(p.images)})
            if len(texto.strip()) < 40:
                sem_texto.append(i)
            for tabela in p.extract_tables():
                for linha in tabela:
                    for c in linha:
                        if c and c.strip():
                            celulas.append({"pagina": i, "texto": c})
    markdown = ""
    if _markitdown is not None:
        try:
            markdown = _markitdown.convert_stream(io.BytesIO(pdf_bytes), file_extension=".pdf").text_content
        except Exception:
            markdown = ""
    if not markdown:
        markdown = "\n\n".join(p["texto"] for p in paginas)
    return {"paginas": paginas, "celulas": celulas, "markdown": markdown, "paginas_sem_texto": sem_texto}


def ocr(pdf_bytes, paginas, idioma="por"):
    """OCR só nas páginas pedidas (PDF escaneado)."""
    import pytesseract
    saida = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for n in paginas:
            img = pdf.pages[n - 1].to_image(resolution=200).original
            saida.append({"pagina": n, "texto": pytesseract.image_to_string(img, lang=idioma)})
    return saida


# ---------------------------------------------------------------- linhas com layout
def _linhas(pdf_bytes):
    """Cada linha com página, recuo, negrito e nível de marcador de lista.

    Nos PDFs testados, os marcadores de lista são desenhos (curves/rects), não texto.
    """
    out = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for pi, p in enumerate(pdf.pages, start=1):
            marcadores = [(o["x0"], o["top"]) for o in (p.curves + p.rects)
                          if o["x0"] < 120 and (o["x1"] - o["x0"]) < 8 and (o["bottom"] - o["top"]) < 8]
            for l in p.extract_text_lines(return_chars=True):
                t = l["text"].strip()
                if not t or RODAPE.match(t):
                    continue
                m = [bx for bx, bt in marcadores if abs(bt - l["top"]) < 6 and bx < l["x0"]]
                letras = [c for c in l["chars"] if c["text"].strip()]
                out.append({
                    "pagina": pi,
                    "x0": round(l["x0"]),
                    "marcador_x": round(min(m)) if m else None,
                    "negrito": bool(letras) and all("Bold" in c["fontname"] for c in letras),
                    "texto": t,
                })
    return out


# ---------------------------------------------------------------- partes do edital
TIPOS_PARTE = [
    ("termo_referencia", r"TERMO DE REFER"),
    ("estudo_tecnico", r"ESTUDO TECNICO"),
    ("minuta_contrato", r"CONTRATO"),
    ("norma_interna", r"PORTARIA|CODIGO DE CONDUTA"),
    ("modelo_proposta", r"PROPOSTA"),
    ("modelo_declaracao", r"DECLARA"),
    ("planilha_orcamentaria", r"PLANILHA|ORCAMENT"),
]
GERA_REQUISITOS = {"termo_referencia"}


def partes(pdf_bytes, linhas=None):
    """Detecta os anexos ('ANEXO II' + título na linha seguinte) e se geram requisitos."""
    linhas = linhas or _linhas(pdf_bytes)
    achados = []
    for i, l in enumerate(linhas):
        if re.fullmatch(r"ANEXO\s+[IVXLC]+(\.\d+)?", l["texto"].strip()):
            titulo = linhas[i + 1]["texto"] if i + 1 < len(linhas) else ""
            tipo = next((t for t, p in TIPOS_PARTE if re.search(p, normalizar(titulo))), "outro")
            achados.append({"titulo": l["texto"].strip(), "nome": titulo.strip(), "tipo": tipo,
                            "pagina_inicio": l["pagina"], "gera_requisitos": tipo in GERA_REQUISITOS})
    return achados


# ---------------------------------------------------------------- tabelas de itens
def _brl(v):
    if not v:
        return None
    m = re.search(r"[\d.]+,\d{2}", v)
    return float(m.group(0).replace(".", "").replace(",", ".")) if m else None


def _num(v):
    m = re.search(r"\d+", v or "")
    return int(m.group(0)) if m else None


def _coluna(cab, *padroes):
    for i, c in enumerate(cab):
        if any(re.search(p, c) for p in padroes):
            return i
    return None


def tabelas_de_itens(pdf_bytes):
    """Toda tabela com colunas de item + quantidade + especificação/descrição."""
    encontradas = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for pi, p in enumerate(pdf.pages, start=1):
            for tb in p.extract_tables():
                if not tb or len(tb) < 2:
                    continue
                cab = [normalizar(c) for c in tb[0]]
                ci = _coluna(cab, r"^ITEM$")
                cq = _coluna(cab, r"QUANT|QTD")
                cd = _coluna(cab, r"ESPECIFICA|DESCRI")
                if ci is None or cq is None or cd is None:
                    continue
                cl = _coluna(cab, r"^LOTE$")
                cu = _coluna(cab, r"UNIDADE")
                cvu = _coluna(cab, r"UNITARIO")
                cvt = _coluna(cab, r"VALOR TOTAL")
                cods = [(i, c) for i, c in enumerate(cab) if re.search(r"CATMAT|CATSER|PMC|CODIGO", c)]
                itens = []
                for row in tb[1:]:
                    row = [(c or "").replace("\n", " ").strip() for c in row]
                    if not re.fullmatch(r"\d+", row[ci] or ""):
                        continue
                    itens.append({
                        "item": str(int(row[ci])),
                        "lote": row[cl] if cl is not None else None,
                        "descricao": row[cd],
                        "codigos_catalogo": [{"tipo": nome, "codigo": row[i]}
                                             for i, nome in cods if row[i]],
                        "unidade": row[cu] if cu is not None else None,
                        "quantidade": _num(row[cq]),
                        "valor_unitario_estimado": _brl(row[cvu]) if cvu is not None else None,
                        "valor_total_estimado": _brl(row[cvt]) if cvt is not None else None,
                    })
                if itens:
                    encontradas.append({"pagina": pi, "itens": itens})
    return encontradas


# ---------------------------------------------------------------- metadados
def metadados(markdown):
    def acha(p):
        m = re.search(p, markdown, re.S | re.I)
        return re.sub(r"\s+", " ", m.group(1)).strip() if m else None
    return {
        "numero": acha(r"PREG[ÃA]O\s+ELETR[ÔO]NICO\s*(?:N[º°.]*\s*)?(\d+/\d{4})"),
        "processo": acha(r"N[º°]\s*do\s*Processo:\s*([\d./-]+)") or acha(r"Processo\s+Administrativo\s*n?[º°]?\s*([\d./-]+)"),
        "uasg": acha(r"\((\d{6})\)\s*[–-]") or acha(r"UASG\s*:?\s*(\d{6})"),
        "orgao": acha(r"\(\d{6}\)\s*[–-]\s*([^\n]+)"),
        "criterio_julgamento": acha(r"CRIT[ÉE]RIO DE JULGAMENTO:?\s*\n+\s*([^\n]+)"),
        "valor_total": _brl(acha(r"VALOR TOTAL DA CONTRATA[ÇC][ÃA]O\s*\n+\s*(R\$\s?[\d.,]+)") or ""),
        "validade_minima_proposta_dias": _num(acha(r"validade da proposta n[ãa]o ser[áa] inferior a\s*(\d+)") or ""),
    }


# ---------------------------------------------------------------- esqueleto do TR
PADROES_ITEM = [
    re.compile(r"especifica\w*.*?\bitem\s*0*(\d+)\s*[:\-–]\s*(.+)", re.I),
    re.compile(r"^item\s*0*(\d+)\s*[:\-–]\s*(.+)", re.I),
]
# Títulos de lote/grupo: "Lote 1 – Mobiliário", "GRUPO 02: ...", "Especificações técnicas do Lote 1"
PADROES_LOTE = [
    re.compile(r"especifica\w*.*?\b(?:lote|grupo)\s*0*(\d+)\s*(?:[:\-–]\s*(.*))?$", re.I),
    re.compile(r"^(?:lote|grupo)\s*0*(\d+)\s*(?:[:\-–]\s*(.*))?$", re.I),
]
PADRAO_GERAIS = re.compile(r"requisitos\s+gerais", re.I)
PADRAO_CAPITULO = re.compile(r"^\d+\.\s+[A-ZÇÃÕÉÍÓÚÂÊ ,/-]{5,}$")


def esqueleto(pdf_bytes, linhas=None):
    """Seções (negrito na margem), requisitos (linha com marcador) e sub-requisitos (marcador recuado).

    Sem marcadores detectáveis, devolve 'sem_marcadores' para o backend usar a extração por IA.
    """
    linhas = linhas or _linhas(pdf_bytes)
    if not any(l["marcador_x"] is not None for l in linhas):
        return {"sem_marcadores": True, "blocos": {}}
    margem_marcador = min(l["marcador_x"] for l in linhas if l["marcador_x"] is not None)
    blocos, atual, secao, lote_atual = {}, None, None, None
    for l in linhas:
        t = l["texto"]
        sem_marcador_negrito = l["negrito"] and l["marcador_x"] is None
        achou_lote = next((p.search(t) for p in PADROES_LOTE if p.search(t)), None) if sem_marcador_negrito else None
        if achou_lote:
            # Começa um lote: o que vier antes do primeiro item é "comum ao lote".
            lote_atual = str(int(achou_lote.group(1)))
            atual, secao = f"lote_{lote_atual}", None
            blocos[atual] = {"item": None, "lote": lote_atual, "descricao": (achou_lote.group(2) or "").strip() or f"Lote {lote_atual}", "linhas": []}
            continue
        achou_item = next((p.search(t) for p in PADROES_ITEM if p.search(t)), None) if l["negrito"] else None
        if achou_item:
            atual = f"item_{int(achou_item.group(1))}"
            secao = None
            blocos[atual] = {"item": str(int(achou_item.group(1))), "lote": lote_atual, "descricao": achou_item.group(2).strip(), "linhas": []}
            continue
        if l["negrito"] and PADRAO_GERAIS.search(t) and l["marcador_x"] is None and not lote_atual:
            atual, secao = "geral", t.rstrip(":").strip()
            blocos[atual] = {"item": None, "lote": None, "descricao": t.strip(), "linhas": []}
            continue
        if PADRAO_CAPITULO.match(t):
            atual, lote_atual = None, None
        if not atual:
            continue
        lst = blocos[atual]["linhas"]
        if l["marcador_x"] is None:
            if l["negrito"] and l["x0"] <= margem_marcador:
                secao = t.rstrip(":").strip()
            elif lst:
                lst[-1]["texto"] = re.sub(r"\s+", " ", lst[-1]["texto"] + " " + t)
            continue
        nivel = 1 if l["marcador_x"] <= margem_marcador + 10 else 2
        reg = {"id": f"{atual}-L{len(lst) + 1:03d}", "secao": secao, "nivel": nivel, "texto": t, "pagina": l["pagina"]}
        if nivel == 2:
            pais = [r for r in lst if r["nivel"] == 1]
            if pais:
                reg["pai"] = pais[-1]["id"]
        lst.append(reg)
    for b in blocos.values():
        pais = {r.get("pai") for r in b["linhas"] if r.get("pai")}
        for r in b["linhas"]:
            r["so_agrupa"] = r["id"] in pais
    return {"sem_marcadores": False, "blocos": blocos}


def capitulos(pdf_bytes, linhas=None):
    """Capítulos numerados de texto corrido ('4. REQUISITOS DA CONTRATAÇÃO'), com o texto de cada um.

    Títulos repetidos (ex.: o sumário do edital) são unidos, ficando o trecho com mais texto.
    """
    linhas = linhas or _linhas(pdf_bytes)
    caps, atual = [], None
    for l in linhas:
        if PADRAO_CAPITULO.match(l["texto"]):
            atual = {"titulo": l["texto"], "pagina": l["pagina"], "texto": ""}
            caps.append(atual)
        elif atual:
            atual["texto"] += l["texto"] + "\n"
    unicos = {}
    for c in caps:
        if c["titulo"] not in unicos or len(c["texto"]) > len(unicos[c["titulo"]]["texto"]):
            unicos[c["titulo"]] = c
    return [c for c in unicos.values() if c["texto"].strip()]


# ---------------------------------------------------------------- LGPD
PADROES_LGPD = {
    "CPF": r"(?<!\d)\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)",
    "RG": r"(?<![\d/])\d{2}\.\d{3}\.\d{3}-[\dXx](?![\d/])",
    "TELEFONE": r"\(\d{2}\)\s?9?\d{4}-?\d{4}",
    "EMAIL": r"[\w.+-]+@[\w-]+\.[\w.]+",
    "DADOS_BANCARIOS": r"(?i)(?:ag[eê]ncia|ag\.)\s*:?\s*[\d-]+|\b(?:CC|C/C|[Cc]onta\s*n?[ºª°]?)\s*:?\s*[\d.-]+",
}


def mascarar(texto):
    """Mascara dados pessoais e bancários; o CNPJ (dado da empresa) é mantido."""
    contagem = {}
    for nome, padrao in PADROES_LGPD.items():
        contagem[nome] = len(re.findall(padrao, texto))
        texto = re.sub(padrao, f"[{nome}]", texto)
    return texto, contagem
