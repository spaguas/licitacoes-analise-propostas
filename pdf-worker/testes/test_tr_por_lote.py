"""TR sintético organizado por LOTES (formato diferente do da SP Águas): garante que o leitor
reconhece lotes, itens dentro do lote e requisitos comuns ao lote. Fonte: testes/dados/tr_lote.html."""
import pathlib
import unittest

import leitura

PDF = (pathlib.Path(__file__).parent / "dados" / "TR_por_lote.pdf").read_bytes()


class TestTrPorLote(unittest.TestCase):
    def test_lotes_itens_e_requisitos_comuns(self):
        b = leitura.esqueleto(PDF)["blocos"]
        self.assertEqual([t["texto"] for t in b["lote_1"]["linhas"]], ["Garantia mínima de 24 meses", "Cor preta ou grafite"])
        self.assertEqual((b["item_1"]["lote"], b["item_2"]["lote"], b["item_3"]["lote"]), ("1", "1", "2"))
        self.assertEqual(len(b["item_1"]["linhas"]), 2)
        self.assertEqual(b["item_1"]["linhas"][0]["secao"], "Dimensões")

    def test_tabela_de_itens_com_lote(self):
        itens = leitura.tabelas_de_itens(PDF)[0]["itens"]
        self.assertEqual([(i["item"], i["lote"], i["quantidade"]) for i in itens], [("1", "1", 20), ("2", "1", 20), ("3", "2", 5)])


if __name__ == "__main__":
    unittest.main()
