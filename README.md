# Frete Interno

Sistema para os motoristas apontarem, pelo celular, as notas fiscais entregues e o código de ocorrência (tabela EDI PROCEDA). Ao encerrar o apontamento, o sistema gera o arquivo **OCOREN no layout PROCEDA 5.0** e registra tudo numa planilha acumulada.

## Versões

| Pasta | Onde roda | Custo |
|---|---|---|
| [`google-apps-script/`](google-apps-script/) **(recomendada)** | Servidores do Google: Planilha Google + Google Drive | Gratuito, sem servidor |
| [`servidor-python/`](servidor-python/) | Computador ou servidor próprio (Flask + SQLite + Excel) | Depende da hospedagem |

O passo a passo de instalação está no `LEIA-ME.md` de cada pasta.

## Funcionalidades

- Login com usuário e senha para cada motorista, mais um perfil de administrador.
- Lançamento da NF com a ocorrência escolhida numa lista pré-definida com busca, a data pelo calendário e o horário.
- Cada NF é salva na hora. Sem sinal, a NF fica guardada no celular e é enviada sozinha quando a conexão volta.
- Ao encerrar, gera um TXT OCOREN 5.0 com nome único (`ocoren_AAMMDDHHMM_NNNNNNNNNN.txt`).
- A planilha acumulada nunca tem linhas apagadas.
- Visual no padrão da marca Calibre.
