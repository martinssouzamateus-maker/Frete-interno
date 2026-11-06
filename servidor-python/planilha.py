"""Planilha Excel acumulada dos apontamentos.

Regras:
- Nunca apaga linhas existentes. Cada apontamento tem um ID (coluna A); se o ID ja
  existe na planilha a linha e atualizada, senao e acrescentada ao final.
- Apontamentos excluidos pelo motorista continuam na planilha com status EXCLUIDO.
- O banco de dados e a fonte da verdade. Se a planilha estiver aberta/travada
  (ex.: aberta no Excel), os registros ficam marcados como pendentes e sao
  gravados automaticamente na proxima tentativa.
"""
import os
import threading
import tempfile

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

ABA = "Apontamentos"
COLUNAS = [
    ("ID", 8), ("Registrado em", 18), ("Motorista", 24), ("Usuário", 14),
    ("Nota Fiscal", 13), ("Série NF", 9), ("CNPJ emissor NF", 20),
    ("Cód. ocorrência", 11), ("Descrição da ocorrência", 46),
    ("Data ocorrência", 14), ("Hora ocorrência", 11), ("Recebedor", 26),
    ("Observação", 36), ("Romaneio", 14), ("Filial CT-e", 11), ("Série CT-e", 10),
    ("Nº CT-e", 14), ("Cód. obs.", 9), ("Lote", 8), ("Status", 12),
    ("Arquivo TXT", 36), ("Encerrado em", 18), ("Última alteração", 18),
]

_lock = threading.Lock()

ROSA = "E60B85"
MARINHO = "312E4C"


def _novo_workbook():
    wb = Workbook()
    ws = wb.active
    ws.title = ABA
    ws.append([c[0] for c in COLUNAS])
    for i, (_, larg) in enumerate(COLUNAS, start=1):
        cel = ws.cell(row=1, column=i)
        cel.font = Font(bold=True, color="FFFFFF", name="Arial")
        cel.fill = PatternFill("solid", fgColor=ROSA)
        cel.alignment = Alignment(vertical="center", horizontal="center", wrap_text=True)
        ws.column_dimensions[get_column_letter(i)].width = larg
    ws.row_dimensions[1].height = 30
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = "A1:%s1" % get_column_letter(len(COLUNAS))
    return wb


def _linha(r):
    def br(d):
        if not d:
            return ""
        a, m, dd = d[:10].split("-")
        return "%s/%s/%s%s" % (dd, m, a, d[10:16].replace("T", " ") if len(d) > 10 else "")
    return [
        r["id"], br(r["criado_em"]), r["motorista_nome"], r["usuario_login"],
        r["numero_nf"], r["serie_nf"], r["cnpj_emissor"],
        r["cod_ocorrencia"], r["descricao_ocorrencia"],
        br(r["data_ocorrencia"]), r["hora_ocorrencia"], r["recebedor"] or "",
        r["observacao"] or "", r["romaneio"] or "", r["filial_cte"] or "",
        r["serie_cte"] or "", r["numero_cte"] or "", r["cod_obs"],
        r["lote_id"] or "", r["status"], r["arquivo_txt"] or "",
        br(r["encerrado_em"]), br(r["atualizado_em"]),
    ]


def sincronizar(caminho, registros):
    """Grava/atualiza os registros na planilha. Retorna (ok, mensagem)."""
    if not registros:
        return True, "nada a gravar"
    with _lock:
        try:
            pasta = os.path.dirname(os.path.abspath(caminho))
            os.makedirs(pasta, exist_ok=True)
            if os.path.exists(caminho):
                wb = load_workbook(caminho)
                ws = wb[ABA] if ABA in wb.sheetnames else wb.create_sheet(ABA)
                if ws.max_row == 1 and ws.cell(1, 1).value is None:
                    ws.append([c[0] for c in COLUNAS])
            else:
                wb = _novo_workbook()
                ws = wb[ABA]

            indice = {}
            for row in ws.iter_rows(min_row=2, min_col=1, max_col=1):
                v = row[0].value
                if v not in (None, ""):
                    try:
                        indice[int(v)] = row[0].row
                    except (TypeError, ValueError):
                        pass

            fonte = Font(name="Arial", size=10)
            for r in registros:
                valores = _linha(r)
                lin = indice.get(int(r["id"]))
                if lin is None:
                    ws.append(valores)
                    lin = ws.max_row
                    indice[int(r["id"])] = lin
                else:
                    for col, v in enumerate(valores, start=1):
                        ws.cell(row=lin, column=col, value=v)
                for col in range(1, len(COLUNAS) + 1):
                    ws.cell(row=lin, column=col).font = fonte
                # texto para nao perder zeros a esquerda
                for col in (5, 7, 8, 14, 17):
                    ws.cell(row=lin, column=col).number_format = "@"

            fd, tmp = tempfile.mkstemp(suffix=".xlsx", dir=pasta)
            os.close(fd)
            try:
                wb.save(tmp)
                os.replace(tmp, caminho)
            finally:
                if os.path.exists(tmp):
                    os.remove(tmp)
            return True, "ok"
        except PermissionError:
            return False, "Planilha aberta ou bloqueada por outro programa. Será gravada na próxima tentativa."
        except Exception as e:  # noqa
            return False, "Falha ao gravar planilha: %s" % e
