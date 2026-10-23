"""Testes com os documentos reais do Pregão 54/2026.

Rode a partir da pasta pdf-worker:
    python -m unittest discover -s testes -v
Os PDFs ficam fora do Git (contêm dados pessoais). Informe a pasta em PDFS_DIR.
"""
import json
import os
import pathlib
import unittest

import leitura

PASTA = pathlib.Path(os.getenv("PDFS_DIR", "../docs/pdfs-de-teste"))
EDITAL = PASTA / "SEI_0119973502_Minuta.pdf"
TR = PASTA / "TR262101_000222_2026__3__-_Copia.pdf"
PROPOSTA = PASTA / "Proposta_Rascorp_Item_1.pdf"
FIXTURES = pathlib.Path(__file__).resolve().parents[2] / "fixtures"


@unittest.skipUnless(TR.exists(), "PDFs de teste não encontrados (defina PDFS_DIR)")
class TestDocumentosReais(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.edital = EDITAL.read_bytes()
        cls.tr = TR.read_bytes()
        cls.proposta = PROPOSTA.read_bytes()

    def test_esqueleto_do_tr(self):
        esq = leitura.esqueleto(self.tr)
        self.assertFalse(esq["sem_marcadores"])
        b = esq["blocos"]
        self.assertEqual(len(b["item_1"]["linhas"]), 51)
        self.assertEqual(len(b["item_2"]["linhas"]), 42)
        self.assertEqual(len(b["geral"]["linhas"]), 3)
        self.assertEqual([r["id"] for r in b["item_1"]["linhas"] if r["so_agrupa"]], ["item_1-L003", "item_1-L021"])

    def test_esqueleto_igual_ao_gabarito(self):
        gab = json.loads((FIXTURES / "esqueleto_tr.json").read_text(encoding="utf-8"))
        b = leitura.esqueleto(self.tr)["blocos"]
        for chave in ("item_1", "item_2"):
            textos = [r["texto"] for r in b[chave]["linhas"]]
            self.assertEqual(textos, [r["texto"] for r in gab[chave]["requisitos"]])

    def test_tabela_de_itens_e_conflito_com_planilha(self):
        tr = leitura.tabelas_de_itens(self.tr)[0]["itens"]
        self.assertEqual([(i["item"], i["quantidade"], i["valor_unitario_estimado"]) for i in tr],
                         [("1", 36, 5405.31), ("2", 148, 4425.69)])
        self.assertEqual(tr[1]["codigos_catalogo"][1]["codigo"], "656217")
        planilhas = [t for t in leitura.tabelas_de_itens(self.edital) if t["pagina"] >= 30]
        self.assertEqual(planilhas[-1]["itens"][0]["valor_unitario_estimado"], 5550.00)

    def test_partes_do_edital(self):
        p = {x["titulo"]: x for x in leitura.partes(self.edital)}
        self.assertEqual(p["ANEXO I"]["tipo"], "termo_referencia")
        self.assertEqual(p["ANEXO II"]["tipo"], "minuta_contrato")
        self.assertEqual(p["ANEXO III"]["tipo"], "norma_interna")
        self.assertEqual(p["ANEXO VI"]["tipo"], "planilha_orcamentaria")
        self.assertEqual([x["titulo"] for x in p.values() if x["gera_requisitos"]], ["ANEXO I"])

    def test_metadados(self):
        m = leitura.metadados(leitura.converter(self.edital)["markdown"])
        self.assertEqual(m["numero"], "54/2026")
        self.assertEqual(m["processo"], "137.00004821/2026-17")
        self.assertEqual(m["uasg"], "262101")
        self.assertEqual(m["criterio_julgamento"], "Menor Preço por item")
        self.assertEqual(m["valor_total"], 858293.44)

    def test_mascaramento_lgpd(self):
        conv = leitura.converter(self.proposta)
        texto = "\n".join(p["texto"] for p in conv["paginas"])
        mascarado, contagem = leitura.mascarar(texto)
        self.assertEqual(contagem["CPF"], 3)
        self.assertEqual(contagem["RG"], 3)
        self.assertGreaterEqual(contagem["DADOS_BANCARIOS"], 4)
        self.assertIn("64.911.773/0001-02", mascarado)          # CNPJ mantido
        self.assertNotRegex(mascarado, r"\d{3}\.\d{3}\.\d{3}-\d{2}")

    def test_celulas_da_proposta_tem_os_trechos(self):
        conv = leitura.converter(self.proposta)
        celulas = [leitura.normalizar(c["texto"]) for c in conv["celulas"]]
        for trecho in ("Módulo de memória RAM 1", "Com monitor Não", "FONTE BIVOLT AUTOMÁTICO OU MANUAL"):
            self.assertTrue(any(leitura.normalizar(trecho) in c for c in celulas), trecho)


if __name__ == "__main__":
    unittest.main()
