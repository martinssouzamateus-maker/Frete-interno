# Frete Interno – versão gratuita (Google Apps Script)

Esta versão roda nos servidores do Google, sem mensalidade e sem precisar de nenhum computador ligado. Você só precisa de uma conta Google (Gmail ou Google Workspace da empresa).

- A **Planilha Google** é o banco de dados e a planilha de apontamentos. As linhas são acrescentadas ou atualizadas, nunca apagadas.
- Cada encerramento gera um **TXT OCOREN 5.0** com nome único (`ocoren_AAMMDDHHMM_NNNNNNNNNN.txt`) na pasta **"Frete Interno - TXT OCOREN"** do seu Google Drive.
- Os motoristas acessam por um link, de qualquer lugar, sem precisar de conta Google. Eles entram com o usuário e a senha que você cadastra no sistema.

Use de preferência uma conta Google da empresa, por exemplo `logistica@...`, em vez de uma conta pessoal. Os arquivos ficam no Drive dessa conta.

## Instalação (uns 10 minutos, uma única vez)

### 1. Criar a planilha e o projeto
1. Acesse sheets.google.com e crie uma **planilha em branco**. Dê o nome "Frete Interno".
2. No menu da planilha, clique em **Extensões → Apps Script**. O editor abre numa nova aba.

### 2. Colar o código
1. No editor já existe um arquivo `Código.gs`. Apague todo o conteúdo dele e cole o conteúdo de **Codigo.gs**.
2. Na linha `var SENHA_INICIAL_ADMIN = 'troque-esta-senha';`, troque o texto entre aspas por uma senha sua.
3. Clique no **+** ao lado de "Arquivos", escolha **HTML** e dê o nome **Index** (exatamente assim, com I maiúsculo e sem ".html"). Apague o conteúdo e cole o conteúdo de **Index.html**.
4. Clique em **Salvar** (ícone de disquete).

### 3. Configurar
1. Na barra do editor, no campo de seleção de função, escolha **configurar** e clique em **Executar**.
2. O Google pede autorização. Clique em **Revisar permissões**, escolha sua conta e, na tela "O Google não verificou este app", clique em **Avançado → Acessar Frete Interno (não seguro)** → **Permitir**.
   Esse aviso aparece em todo script próprio. O script só acessa esta planilha e cria uma pasta no seu Drive.
3. O registro de execução mostra "Configuração concluída". Na planilha aparecem as abas Apontamentos, Lotes, Usuarios, Config e Ocorrencias.

### 4. Publicar o site
1. Clique em **Implantar → Nova implantação**.
2. Na engrenagem "Selecionar tipo", escolha **App da Web**.
3. Preencha:
   - **Executar como:** Eu (sua conta)
   - **Quem pode acessar:** Qualquer pessoa
4. Clique em **Implantar** e copie o **URL do app da Web**, que termina em `/exec`. Esse é o link do sistema.

### 5. Primeiro acesso
1. Abra o link, entre com o usuário **admin** e a senha que você definiu no passo 2, e crie uma nova senha.
2. No menu do topo, abra **Administração → Configurações** e revise os dados da transportadora e dos emissores. Eles vão no cabeçalho do TXT.
3. Em **Usuários**, cadastre cada motorista com uma senha inicial. No primeiro acesso, ele cria a própria senha.
4. Envie o link para os motoristas. No celular, eles podem usar **"Adicionar à tela inicial"** para abrir como um aplicativo.

## Uso no dia a dia

- **Motorista:** digita a NF, escolhe a ocorrência na lista, a data no calendário e o horário. Toca em **Adicionar NF**, e cada nota é salva na hora. No fim da rota, toca em **Encerrar e gerar arquivo**.
- **Sem sinal:** a NF fica guardada no celular e é enviada sozinha quando a conexão volta.
- **Administrador:** a tela de Administração tem os links "Abrir planilha" e "Pasta dos TXT", a lista de arquivos (Baixar / Abrir no Drive), as NFs em aberto e o cadastro de usuários.
- **Excel:** na planilha Google, use **Arquivo → Fazer download → Microsoft Excel (.xlsx)**.

Cuidados:
- Não apague nem reordene as colunas das abas. Pode filtrar, colorir e criar outras abas à vontade.
- A aba **Ocorrencias** é a lista que aparece para o motorista. Pode editar as descrições ou acrescentar códigos.
- A aba **Usuarios** guarda as senhas criptografadas. Não altere as colunas "Sal" e "Hash da senha".

## Atualizar o sistema depois de alterar o código

Cole o novo código e salve. Depois vá em **Implantar → Gerenciar implantações**, clique no lápis, escolha **Versão: Nova versão** e clique em **Implantar**. O link continua o mesmo.

## Limites do plano gratuito do Google

O uso de uma equipe de motoristas (dezenas a centenas de NFs por dia) fica bem dentro dos limites gratuitos do Apps Script. Cada ação leva de 1 a 3 segundos, um pouco mais lenta que um servidor próprio. No topo da página aparece uma faixa do Google ("Este aplicativo foi criado por um usuário do Google Apps Script"); isso é normal.

## Layout OCOREN 5.0

Linhas de 250 posições, ASCII sem acentos, CRLF. O gerador foi validado caractere por caractere contra o arquivo de exemplo `ocoren_2610280846_4945709820_ok.txt`. Registros: 000 (cabeçalho), 540, 541 (transportadora), 542 (uma por NF), 543 (texto com recebedor e observação) e 549 (quantidade). Código de observação: 03 para ocorrências de entrega efetivada (001, 002, 024, 031, 104, 105) e 00 para as demais.

## Arquivos

| Arquivo | Para quê |
|---|---|
| `Codigo.gs` | Código do servidor (colar no Apps Script) |
| `Index.html` | Página do sistema (colar no arquivo HTML "Index") |
| `appsscript.json` | Opcional: manifesto com fuso de Brasília |
| `fonte/` | Fontes da página, para quem for manter o sistema |
