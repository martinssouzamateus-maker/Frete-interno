"""Gerador de arquivo OCOREN - layout PROCEDA 5.0 (linhas de 250 posicoes, CRLF).

Registros gerados:
  000  Cabecalho de intercambio (remetente, destinatario, data/hora, id intercambio)
  540  Cabecalho do documento   (OCORR50DDMMSSS)
  541  Dados da transportadora  (CNPJ + razao social)
  542  Ocorrencia na entrega    (um por nota fiscal apontada)
  543  Complemento / texto livre da ocorrencia
  549  Trailer (quantidade de registros 542)

Posicoes do registro 542 (1-based), conforme layout 5.0 e o arquivo de exemplo:
  001-003 "542"
  004-017 CNPJ do emissor da NF            N 14
  018-020 Serie da NF                      A 3
  021-029 Numero da NF                     N 9
  030-032 Codigo da ocorrencia             N 3
  033-040 Data da ocorrencia DDMMAAAA      N 8
  041-044 Hora da ocorrencia HHMM          N 4
  045-046 Codigo de observacao             N 2
  047-066 Romaneio / ordem de coleta       A 20
  067-126 Numeros SAP 1, 2 e 3             A 60
  127-136 Filial emissora do CT-e          A 10
  137-141 Serie do CT-e                    A 5
  142-153 Numero do CT-e                   N 12
  154     Indicacao do tipo de entrega     N 1
  155-250 Campos complementares (redespacho/devolucao) - preenchidos como no exemplo
"""
import unicodedata
from datetime import datetime

TAM_LINHA = 250
EOL = "\r\n"


def ascii_txt(texto):
    """Remove acentos e caracteres fora do ASCII (o arquivo OCOREN e ASCII puro)."""
    if texto is None:
        return ""
    t = unicodedata.normalize("NFKD", str(texto))
    t = "".join(c for c in t if not unicodedata.combining(c))
    t = t.replace("\r", " ").replace("\n", " ").replace("\t", " ")
    return t.encode("ascii", "ignore").decode("ascii")


def so_digitos(v):
    return "".join(c for c in str(v or "") if c.isdigit())


def A(v, n):
    """Campo alfanumerico: alinhado a esquerda, completado com espacos."""
    return ascii_txt(v)[:n].ljust(n)


def N(v, n):
    """Campo numerico: alinhado a direita, completado com zeros."""
    d = so_digitos(v)[-n:] if v not in (None, "") else ""
    return d.zfill(n)


def linha(conteudo):
    if len(conteudo) > TAM_LINHA:
        conteudo = conteudo[:TAM_LINHA]
    return conteudo.ljust(TAM_LINHA)


def reg_000(remetente, destinatario, gerado_em, seq):
    ident = "OCO50" + gerado_em.strftime("%d%m") + N(seq, 3)
    return linha("000" + A(remetente, 35) + A(destinatario, 35)
                 + gerado_em.strftime("%d%m%y") + gerado_em.strftime("%H%M") + A(ident, 12))


def reg_540(gerado_em, seq):
    return linha("540" + A("OCORR50" + gerado_em.strftime("%d%m") + N(seq, 3), 14))


def reg_541(cnpj_transp, razao_transp):
    return linha("541" + N(cnpj_transp, 14) + A(razao_transp, 50))


def reg_542(r):
    """r: dict com cnpj_emissor, serie_nf, numero_nf, cod_ocorrencia, data (date/str AAAA-MM-DD),
    hora (HH:MM), cod_obs, romaneio, filial_cte, serie_cte, numero_cte, tipo_entrega"""
    data = r["data_ocorrencia"]
    if isinstance(data, str):
        data = datetime.strptime(data, "%Y-%m-%d")
    hora = so_digitos(r["hora_ocorrencia"])[:4].ljust(4, "0")
    romaneio = ascii_txt(r.get("romaneio") or "")[:20].rjust(20)  # exemplo traz o romaneio alinhado a direita
    s = ("542"
         + N(r["cnpj_emissor"], 14)
         + A(r.get("serie_nf") or "", 3)
         + N(r["numero_nf"], 9)
         + N(r["cod_ocorrencia"], 3)
         + data.strftime("%d%m%Y")
         + hora
         + N(r.get("cod_obs") or "0", 2)
         + romaneio
         + " " * 60                               # numeros SAP 1/2/3
         + A(r.get("filial_cte") or "", 10)
         + N(r.get("serie_cte") or "0", 5)
         + N(r.get("numero_cte") or "0", 12)
         + N(r.get("tipo_entrega") or "1", 1)
         + " " * 10
         + "0" * 62
         + " " * 3
         + "0" * 9)
    return linha(s)


def texto_543(r):
    partes = [ascii_txt(r["descricao_ocorrencia"]).upper()]
    if r.get("recebedor"):
        partes[0] += "  - Entrega para: " + ascii_txt(r["recebedor"]).upper()
    if r.get("observacao"):
        partes.append(ascii_txt(r["observacao"]))
    partes.append("via aplicativo movel")
    return "  ".join(p.strip() for p in partes if p.strip())


def reg_543(texto):
    return linha("543" + A(texto, 210))


def reg_549(qtd):
    return linha("549" + N(qtd, 4))


def gerar_ocoren(registros, cfg, gerado_em, seq_dia):
    """Retorna o conteudo completo (str) do arquivo OCOREN."""
    linhas = [
        reg_000(cfg["remetente_nome"], cfg["destinatario_nome"], gerado_em, seq_dia),
        reg_540(gerado_em, seq_dia),
        reg_541(cfg["transportadora_cnpj"], cfg["transportadora_nome"]),
    ]
    for r in registros:
        linhas.append(reg_542(r))
        linhas.append(reg_543(texto_543(r)))
    linhas.append(reg_549(len(registros)))
    return EOL.join(linhas) + EOL


def nome_arquivo(gerado_em, numero_unico):
    """Mesmo padrao do exemplo: ocoren_AAMMDDHHMM_NNNNNNNNNN.txt"""
    return "ocoren_%s_%s.txt" % (gerado_em.strftime("%y%m%d%H%M"), N(numero_unico, 10))
