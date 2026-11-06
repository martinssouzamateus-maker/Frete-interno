# Frete Interno – Apontamento de ocorrências (EDI PROCEDA OCOREN 5.0)

Sistema web para os motoristas apontarem, pelo celular, as notas fiscais entregues e o código de ocorrência. Ao encerrar o apontamento, o sistema gera o arquivo **OCOREN** no layout PROCEDA 5.0 e registra tudo numa planilha Excel acumulada.

## Publicar na internet (sem depender de um computador da empresa)

O GitHub guarda o código, mas não roda o sistema. Para os motoristas acessarem de qualquer lugar, o repositório é ligado a uma hospedagem. A configuração pronta é para o **Render** (render.com):

1. Crie uma conta no Render e entre com o GitHub.
2. Clique em **New > Blueprint** e escolha este repositório. O arquivo `render.yaml` já configura tudo.
3. Quando pedir **ADMIN_SENHA_INICIAL**, informe uma senha forte. Ela é a senha do usuário `admin` no primeiro acesso.
4. Confirme. Em alguns minutos o sistema fica disponível num endereço como `https://frete-interno.onrender.com`, com HTTPS.

Custo: o plano Starter (cerca de US$ 7/mês) mais o disco de 1 GB (cerca de US$ 0,25/mês). O plano gratuito não serve porque apaga os dados a cada reinício. Cada novo envio ao GitHub atualiza o site sozinho.

Para baixar os TXT e a planilha, use a página de Administração: links "Baixar" e "Baixar planilha Excel".

## Instalação local (Windows)

1. Instale o Python 3.10 ou mais novo (python.org) e marque **"Add Python to PATH"** na instalação.
2. Copie a pasta `frete_interno` para o computador ou servidor que vai ficar ligado.
3. Dê dois cliques em `iniciar.bat`. Na primeira vez ele instala as dependências.
4. No próprio computador, abra `http://localhost:8080`.
5. Entre com o usuário **admin** e a senha **admin**. O sistema pede para trocar a senha no primeiro acesso.

Em Linux, use `./iniciar.sh`.

## Primeiros passos do administrador

1. **Configurações**: confira o remetente, o destinatário, o CNPJ e a razão social da transportadora (registros 000 e 541) e os CNPJs emissores das NFs. Os valores iniciais vieram do arquivo de exemplo e **precisam ser revisados**.
2. **Usuários**: crie um usuário para cada motorista com uma senha inicial. No primeiro acesso, o motorista cria a própria senha.
3. Passe para os motoristas o endereço de acesso (veja abaixo).

## Como os motoristas acessam pelo celular

- **Na rede da empresa (Wi-Fi):** use o IP do computador onde o sistema roda, por exemplo `http://192.168.0.50:8080`. Para descobrir o IP, rode `ipconfig` no Windows. Libere a porta 8080 no Firewall do Windows.
- **Na rua (4G):** o servidor precisa estar acessível pela internet. As opções são um servidor da empresa com endereço público ou VPN (fale com a TI), ou uma hospedagem em nuvem com disco persistente. Nesse caso, use HTTPS.
- Dica: no celular, use "Adicionar à tela inicial" para abrir como se fosse um aplicativo.

## Uso pelo motorista

1. Digite o número da NF (a série vem preenchida).
2. Escolha a ocorrência nos atalhos ou toque no campo para abrir a lista completa com busca. São os 119 códigos da tabela PROCEDA.
3. Escolha a data no calendário e o horário. O botão "Usar data e hora de agora" preenche os dois.
4. Nas entregas, informe quem recebeu. A observação é opcional.
5. Toque em **Adicionar NF**. Cada nota é salva no servidor e na planilha **na hora**.
6. No fim da rota, toque em **Encerrar e gerar arquivo**.

O que é salvo automaticamente:
- Cada NF adicionada, editada ou excluída é gravada no banco e na planilha no mesmo instante.
- O formulário em preenchimento fica guardado no celular. Se a tela travar ou a página recarregar, nada se perde.
- **Sem sinal:** a NF fica guardada no celular e é enviada sozinha quando a conexão volta. O botão de encerrar só libera depois do envio.

## Arquivos gerados

| O quê | Onde (padrão) |
|---|---|
| TXT OCOREN, um por encerramento | `dados/txt_ocoren/ocoren_AAMMDDHHMM_NNNNNNNNNN.txt` |
| Planilha acumulada | `dados/apontamentos_ocoren.xlsx` (aba "Apontamentos") |
| Banco de dados | `dados/frete_interno.db` |

- O nome do TXT segue o padrão do exemplo (`ocoren_2610280846_4945709820`). O número final é sequencial e nunca se repete, então nenhum arquivo é sobrescrito.
- A planilha **nunca tem linhas apagadas**. Linhas novas entram no final; uma NF editada antes do encerramento atualiza a própria linha (pelo ID); uma NF excluída fica com status EXCLUIDO. No encerramento, as linhas recebem lote, status ENCERRADO e o nome do TXT.
- Se a planilha estiver aberta no Excel, o Windows bloqueia a gravação. Os dados ficam guardados no banco e entram na planilha na próxima gravação, ou pelo botão "Gravar agora" na Administração. Prefira abrir uma cópia para consultar, ou baixe pelo link "Baixar planilha Excel".
- Para gravar o TXT e a planilha direto numa pasta de rede (por exemplo, a pasta de onde o EDI é enviado), copie `config.ini.exemplo` para `config.ini` e ajuste os caminhos.

## Layout OCOREN 5.0 gerado

Linhas de 250 posições, ASCII sem acentos, terminadas em CRLF. Validado byte a byte contra o arquivo de exemplo `ocoren_2610280846_4945709820_ok.txt`.

| Registro | Conteúdo |
|---|---|
| 000 | Remetente (35), destinatário (35), data DDMMAA, hora HHMM, intercâmbio `OCO50DDMMSSS` |
| 540 | `OCORR50DDMMSSS` (SSS = sequência do dia) |
| 541 | CNPJ e razão social da transportadora |
| 542 | Uma por NF: CNPJ do emissor, série, número, código da ocorrência, data DDMMAAAA, hora HHMM, código de observação, romaneio, filial/série/número do CT-e, tipo de entrega |
| 543 | Texto: descrição da ocorrência + "Entrega para: RECEBEDOR" + observação |
| 549 | Quantidade de ocorrências (542) |

Código de observação (posições 45–46): **03** para ocorrências de entrega efetivada (001, 002, 024, 031, 104, 105) e **00** para as demais, como no exemplo. Para mudar a regra, edite `COD_ENTREGUE` em `app.py`.

## Backup

Faça backup diário da pasta `dados`. O banco `frete_interno.db` tem todo o histórico e permite recriar a planilha.
