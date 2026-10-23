# Análise de Propostas — SP Águas

Sistema web que lê o **edital** e o **Termo de Referência (TR)** de um pregão, lista os **requisitos de cada item (ou lote)**, lê as **propostas** dos fornecedores e monta um **checklist** dizendo o que atende e o que não atende — sempre com a **evidência** (página e trecho) de cada resultado.

> O sistema **sugere**. A decisão é sempre do(a) agente de contratação / pregoeiro(a).

---

## Sumário

1. [O que você precisa ter](#1-o-que-você-precisa-ter)
2. [Instalação (primeira vez)](#2-instalação-primeira-vez)
3. [Configurar as IAs no New API](#3-configurar-as-ias-no-new-api)
4. [Ligar e desligar no dia a dia](#4-ligar-e-desligar-no-dia-a-dia)
5. [Como usar o sistema](#5-como-usar-o-sistema)
6. [Atualizar para uma versão nova](#6-atualizar-para-uma-versão-nova)
7. [Comandos úteis](#7-comandos-úteis)
8. [Configurações do arquivo `.env`](#8-configurações-do-arquivo-env)
9. [Segurança, dados e LGPD](#9-segurança-dados-e-lgpd)
10. [Backup](#10-backup)
11. [Problemas comuns e soluções](#11-problemas-comuns-e-soluções)
12. [Versionamento no GitHub da SP Águas](#12-versionamento-no-github-da-sp-águas)
13. [Estrutura do projeto](#13-estrutura-do-projeto)
14. [Para quem vai programar](#14-para-quem-vai-programar)

---

## 1. O que você precisa ter

### Computador

| Item | Mínimo | Recomendado |
|---|---|---|
| Sistema | Windows 10 (22H2) ou Windows 11, 64 bits | Windows 11 |
| Memória (RAM) | 8 GB (usando só IAs na nuvem) | **16 GB** (necessário para a IA local Qwen) |
| Espaço livre em disco | **15 GB** (programas + modelos de IA ≈ 10 GB) | 25 GB |
| Processador | Com virtualização ativada na BIOS (quase todos os atuais) | — |
| Internet | Necessária na instalação e para as IAs na nuvem | — |

### Programas

| Programa | Para quê | Como instalar |
|---|---|---|
| **Docker Desktop** (com **WSL 2**) | Roda todo o sistema em "containers" — você não instala banco, Node ou Python à mão | No PowerShell: `winget install Docker.DockerDesktop` (ou baixe em docker.com). Reinicie o computador depois. |
| **PowerShell** | Rodar os scripts de instalação | Já vem no Windows |
| VS Code (opcional) | Editar o arquivo `.env` com conforto | `winget install Microsoft.VisualStudioCode` |

Depois de instalar o Docker Desktop, abra-o uma vez e espere aparecer **"Engine running"** (barra inferior). Para conferir, no PowerShell:

```powershell
docker --version
docker compose version
```

Os dois comandos precisam mostrar uma versão. Se der erro, o Docker Desktop não está aberto.

> **Memória do Docker:** com a IA local (Qwen), o Docker precisa de pelo menos **6 GB**. No WSL 2 ele usa até metade da RAM do Windows (8 GB num computador de 16 GB), o que já basta.

### Contas e chaves das IAs

| IA | Papel no sistema (apelido) | Custo | Onde conseguir a chave |
|---|---|---|---|
| **Claude** (Anthropic) | `ia-forte` — julgamentos difíceis e reserva | Pago (por uso) | platform.claude.com → API Keys |
| **Gemini Flash-Lite** (Google) | `ia-leve` — só documentos públicos (edital/TR) | Gratuito (com limites) | aistudio.google.com → Get API key |
| **DeepSeek** *ou* **Qwen local** | `ia-media` — leitura do TR e das propostas | DeepSeek: centavos · Qwen: gratuito | DeepSeek: platform.deepseek.com · Qwen: já vem no sistema, sem chave |

> As chaves dos provedores ficam **só dentro do New API** (o "painel das IAs"). O sistema só conhece **um token**, o do New API.

### Portas que precisam estar livres

| Porta | O que é |
|---|---|
| **8080** | O sistema (telas) |
| **3000** | New API (painel das IAs) |
| **3001** | API do sistema (uso interno) |

O instalador para automaticamente outros containers que estejam usando essas portas.

---

## 2. Instalação (primeira vez)

Tudo é feito no **PowerShell**, com o **Docker Desktop aberto**.

### Passo 1 — Extrair o projeto

```powershell
$zip = Get-ChildItem "$HOME\Downloads\licitacoes-spaguas*.zip" | Sort-Object LastWriteTime | Select-Object -Last 1
Expand-Archive -Path $zip.FullName -DestinationPath "$HOME\Documents" -Force
cd "$HOME\Documents\licitacoes-spaguas"
```

O projeto fica em `Documentos\licitacoes-spaguas`. Confira se os scripts estão lá:

```powershell
Get-ChildItem *.ps1
```

Devem aparecer `instalar.ps1`, `definir-token.ps1` e `trocar-senha.ps1`.

### Passo 2 — Rodar o instalador

```powershell
powershell -ExecutionPolicy Bypass -File .\instalar.ps1 -Limpar
```

O instalador:

1. confere se o Docker está aberto;
2. libera as portas 3000, 3001 e 8080;
3. com `-Limpar`, apaga instalações anteriores **deste sistema** (começa do zero);
4. **pergunta a senha do administrador** — os caracteres não aparecem na tela; use 8 ou mais caracteres, **sem `$` e sem `#`**;
5. cria o arquivo `.env` com todas as outras senhas geradas automaticamente;
6. constrói e liga os containers;
7. baixa os modelos de IA local (Qwen e bge-m3, ≈ 5 GB — mostra o andamento);
8. espera o sistema responder e mostra **"Instalação concluída"**.

> Na primeira vez pode levar de 15 a 40 minutos, dependendo da internet.

### Passo 3 — Configurar as IAs

Siga a seção [3. Configurar as IAs no New API](#3-configurar-as-ias-no-new-api).

### Passo 4 — Entrar no sistema

Abra **http://localhost:8080** e entre com:

- **E-mail:** `admin@spaguas.sp.gov.br`
- **Senha:** a que você criou no Passo 2

> Digite a senha à mão. O preenchimento automático do navegador pode colocar uma senha antiga.

---

## 3. Configurar as IAs no New API

O **New API** é o "painel das IAs": guarda as chaves dos provedores e entrega cada pedido do sistema para a IA certa. Abra **http://localhost:3000**.

### 3.1 Assistente inicial (só na primeira vez)

1. Confira se aparece **PostgreSQL** → **Next**.
2. Crie o administrador do New API (usuário com **no máximo 12 caracteres**) → **Next**.
3. Escolha **Personal use mode** → **Next** → **Initialize system**.
4. Entre com o usuário que você criou.

### 3.2 Grupo (opcional, recomendado)

Em **Settings → Group Pricing**, clique em **Add group**, crie `licitacoes_ia` (Ratio `1`, Top-up ratio `1`, User selectable marcado) e clique em **Save group settings**. Se preferir, use o grupo `default` — funciona igual. **O importante é que os canais e o token usem o mesmo grupo.**

### 3.3 Canais (uma IA por canal)

Em **Channels → Create Channel**, crie os canais abaixo. Em todos:
**Groups** = o seu grupo (`licitacoes_ia` ou `default`) · **Auto-disable** = desligado · depois de salvar, o ícone de liga/desliga precisa ficar **verde**.

| Canal | Type | Base URL | API Key | Models | Model Mapping (JSON) |
|---|---|---|---|---|---|
| Claude | Anthropic Claude | padrão | `sk-ant-...` | `ia-forte` | `{"ia-forte": "claude-sonnet-5-5"}` |
| Gemini | Google Gemini | **vazio** | `AIza...` | `ia-leve` | `{"ia-leve": "gemini-3.5-flash-lite"}` |
| DeepSeek **(opção A)** | DeepSeek | padrão | `sk-...` da DeepSeek | `ia-media` | `{"ia-media": "deepseek-flash"}` |
| Ollama **(opção B)** | Ollama | `http://ollama:11434` | vazio (ou `ollama`) | `ia-media` | `{"ia-media": "qwen3.5:4b"}` |

**Para a `ia-media`, use só um canal ligado: DeepSeek *ou* Ollama.**

- **DeepSeek (opção A):** rápido e barato, mas as propostas vão para a nuvem (sempre **mascaradas**). Confirme com a TI se é permitido.
- **Ollama/Qwen (opção B):** gratuito e 100% local, mas **lento** em computadores sem placa de vídeo.

Sem chave do Gemini, coloque `ia-forte,ia-leve` em **Models** do canal Claude e use o mapeamento `{"ia-forte": "claude-sonnet-5-5", "ia-leve": "claude-haiku-5-5"}`.

Teste cada canal no ícone de **velocímetro** do cartão. Deve aparecer um tempo em **Response**.

### 3.4 Ajustar o `.env` conforme a sua `ia-media`

Abra o `.env` da pasta do projeto (no VS Code: `code .env`) e confira estas linhas:

**Opção A — DeepSeek (nuvem):**
```
ALIASES_NUVEM=ia-leve,ia-media,ia-forte
ROTA_E3_REQUISITOS=ia-media,ia-forte
ROTA_E4_PROPOSTA=ia-media,ia-forte
MEDIA_MAX_CONCURRENT=3
TIMEOUT_MEDIA_SEGUNDOS=120
```

**Opção B — Qwen local (padrão do `.env`):**
```
ALIASES_NUVEM=ia-leve,ia-forte
ROTA_E3_REQUISITOS=ia-media,ia-forte
ROTA_E4_PROPOSTA=ia-media,ia-forte
MEDIA_MAX_CONCURRENT=1
TIMEOUT_MEDIA_SEGUNDOS=300
```

> `ALIASES_NUVEM` diz para quem a proposta só pode ir **mascarada** (CPF, RG, telefone, e-mail e dados bancários escondidos). Se a `ia-media` for a DeepSeek, ela **precisa** estar nessa lista.

### 3.5 Criar o token e ligar no sistema

1. Em **API Keys → Create API Key**: Name `licitacoes-spaguas`, Group = o seu grupo, **Never expires**, **Unlimited Quota** ligado → **Submit**.
2. Copie o token (começa com `sk-`).
3. Na pasta do projeto:

```powershell
powershell -ExecutionPolicy Bypass -File .\definir-token.ps1 -Token sk-SEU-TOKEN
```

O script grava o token no `.env`, reinicia a API e **testa as três IAs**. Se aparecer **OK** para `ia-leve`, `ia-media` e `ia-forte`, está tudo pronto.

---

### 3.6 E-mail (opcional)

Com o e-mail configurado:
- **Esqueceu a senha?** → a pessoa recebe um **link para criar uma nova senha** (vale 30 minutos, uso único).
- **Criar conta** → o administrador recebe um aviso por e-mail; ao aprovar, a pessoa recebe "Seu acesso foi aprovado".

Sem e-mail, tudo continua funcionando pelo menu **Usuários**.

Peça à TI: **servidor SMTP**, **porta** e a **senha** da conta que envia (ex.: `no-reply@spaguas.sp.gov.br`). Depois, na pasta do projeto:

```powershell
powershell -ExecutionPolicy Bypass -File .\configurar-email.ps1
```

O script pergunta os dados (a senha não aparece na tela), grava no `.env`, reinicia a API e **envia um e-mail de teste**.

**Ou, se preferir, edite o `.env` à mão** (acrescente no final; sem espaços em volta do `=`; se a linha já existir, altere a existente em vez de repetir):

```
SMTP_HOST=smtp.office365.com
SMTP_PORTA=587
SMTP_SEGURO=false
SMTP_USUARIO=no-reply@spaguas.sp.gov.br
SMTP_SENHA='COLE-AQUI-A-SENHA'
SMTP_REMETENTE=no-reply@spaguas.sp.gov.br
SMTP_IGNORAR_CERTIFICADO=false
EMAIL_AVISOS_ADMIN=seu.email@dominio.gov.br
APP_URL_PUBLICA=http://localhost:8080
```

- `smtp.office365.com` é o servidor do **Microsoft 365** (contas da empresa). `smtp-mail.outlook.com` é só para contas pessoais (@outlook.com/@hotmail.com).
- A senha vai **entre aspas simples**. Porta **465** → `SMTP_SEGURO=true`; porta **587** → `false`.
- No Microsoft 365, a conta que envia precisa ter o **SMTP autenticado** ativado (a TI faz isso).

Depois de salvar, reinicie a API e teste:

```powershell
docker compose up -d --force-recreate api
docker compose exec api node src/email-teste.js seu.email@dominio.gov.br
```

**Acompanhar os envios:**
- Na tela **Usuários**, o quadro **"E-mail do sistema"** mostra se o e-mail está ativo, os **últimos envios** (✓ ou ✗ com o motivo explicado) e o botão **Enviar e-mail de teste**.
- No terminal: `docker compose logs api --since 30m | Select-String "e-mail"` — cada envio aparece como `enviado para ... (aceito pelo servidor de e-mail)` ou `falhou para ... — motivo`.
- "Aceito pelo servidor" e não chegou? Procure no **Lixo Eletrônico**; se não estiver lá, a TI confere a **quarentena** do Microsoft 365.

> **Links nos e-mails:** enquanto `APP_URL_PUBLICA` for `localhost`, os avisos de cadastro e de aprovação vão **sem link** ("abra o sistema e vá ao menu Usuários"), porque filtros de e-mail desconfiam de links para localhost. Só o e-mail de **criar nova senha** leva link (sem ele não funciona).

> **Endereço dos links:** hoje o sistema só abre no computador onde está instalado (`http://localhost:8080`). Quando ele for para um servidor da SP Águas, troque `APP_URL_PUBLICA` no `.env` pelo endereço do servidor, senão os links dos e-mails não abrem em outros computadores.

---

## 4. Ligar e desligar no dia a dia

Com o **Docker Desktop aberto**, na pasta do projeto:

```powershell
cd "$HOME\Documents\licitacoes-spaguas"
docker compose up -d     # liga
docker compose down      # desliga (os dados ficam guardados)
```

Também dá para usar o Docker Desktop: em **Containers**, o grupo **licitacoes-spaguas** tem os botões ▶ (ligar) e ■ (desligar).

| Endereço | O que é |
|---|---|
| http://localhost:8080 | **O sistema** |
| http://localhost:3000 | New API (painel das IAs) |

---

## 5. Como usar o sistema

O trabalho é feito na página de cada pregão, em **quatro etapas**.

### Etapa 01 — Documentos

1. Clique em **Novo pregão** e dê um nome.
2. Envie o **Edital** (com os anexos) e o **Termo de Referência**.
3. Acompanhe o **pop-up de processamento** (pode minimizar para um círculo no canto da tela).

O sistema mostra:
- **Estrutura da licitação:** se o julgamento é **por item** ou **por lote** (com o trecho e a página onde encontrou), quantos lotes, quantos itens em cada lote e a regra para o fornecedor. Dá para corrigir em **"Corrigir, se preciso"**.
- **Partes do edital:** quais anexos geram requisitos (só o TR) e quais não (contrato, código de conduta, modelos).
- **Itens** com códigos de catálogo, quantidades e valores.
- **Conflitos entre documentos** (ex.: valor do TR diferente da planilha do edital) — o sistema não escolhe um lado; você decide.

### Etapa 02 — Requisitos

- Abas **Geral**, uma por **item** (ou por **lote**, se o edital for por lote) e **Habilitação**.
- **Cobertura do TR** (ex.: "49 de 49 linhas"): confirma que nenhuma linha do TR ficou de fora.
- Cada requisito mostra a **origem** (`TR · p. 3` ou `Edital · p. 6`).
- Botões em cada linha: ✏️ **editar** (corrige o que a IA leu; ao salvar, já fica validado), ✓ **validar**, ✗ **rejeitar**.
- **Validar todos desta aba** valida só a aba aberta.

> Só requisitos **validados** entram na análise.

### Etapa 03 — Propostas

1. Informe o **CNPJ** e a **razão social**.
2. Envie o PDF da proposta (e catálogos, se houver).
3. Clique em **Ver extração** para conferir o que foi lido (marca, modelo, especificações, alertas de *vago*, *alternativas*, *contradição*).

No julgamento por lote, a lista já avisa **"Lote 1 incompleto: falta o item 2"** antes da análise.

### Etapa 04 — Resultados

Clique em **Iniciar análise** (o botão também aparece numa barra fixa no topo quando você rola a página).

- **Visão completa do fornecedor:** **todos** os requisitos validados (gerais, itens, lotes e habilitação), com a conta fechando no total.
- **Por item:** checklist de cada item com o de-para "Item do TR ⇄ Ofertado".
- **Informação ausente na proposta = NÃO ATENDE:** chave por pregão. Desligada, o que falta vira **NÃO COMPROVADO** (cabe diligência).
- **Julgamento:** automático pelo edital, por item ou por lote.
- **Revisar:** em cada linha, confirme ou corrija o resultado e registre um parecer.
- **Gerar texto de recusa / diligência:** monta o texto formal com cada motivo (exigido × ofertado × motivo) e a fundamentação (art. 59, II, da Lei 14.133/2021). Pode **editar**, **melhorar a redação com IA**, **copiar** (para o SEI) ou **baixar .doc**.
- **Exportar (CSV):** abre no Excel.

### Usuários e perfis de acesso

| Perfil | O que vê e faz |
|---|---|
| **Administrador** | Todos os pregões (com "Criado por"), o menu **Uso das IAs** e o menu **Usuários** |
| **Licitante** | Só os pregões que **ele mesmo criou**, com as quatro etapas completas |

No menu **Usuários** (só administrador):
- **Criar usuário:** informe nome, e-mail e perfil → o sistema mostra uma **senha temporária uma única vez** (entregue à pessoa). No primeiro acesso ela é obrigada a criar a própria senha.
- **Perfil:** troque entre Licitante e Administrador.
- **Desativar / Reativar:** desativar derruba as sessões abertas na hora.
- **Nova senha:** gera outra senha temporária (a antiga para de funcionar).
- **Excluir** (ícone de **lixeira** vermelha): apaga o usuário definitivamente, depois de confirmar. Os **pregões que ele criou passam para o administrador que excluiu** (nada se perde); a sessão dele cai na hora. Se a pessoa só não deve mais entrar, prefira **Desativar**, que pode ser desfeito.
- **E-mail do sistema:** quadro com a situação do envio de e-mails, os últimos envios e o botão de teste (ver seção 3.6).

O sistema impede que o administrador desative ou exclua a si mesmo e exige sempre pelo menos um administrador ativo. Exclusões e alterações ficam registradas em **Segurança → Auditoria**.

**Na tela de login:**
- **Criar conta:** a pessoa informa nome, e-mail e senha. O cadastro fica **aguardando aprovação** e aparece em **Usuários → Pedidos aguardando você**. Aprovado, entra como **Licitante** (nunca como administrador). Com e-mail configurado, o administrador recebe um aviso e a pessoa recebe "Seu acesso foi aprovado".
- **Esqueceu a senha?:** com e-mail configurado, a pessoa recebe um **link para criar nova senha** (30 minutos, uso único). Sem e-mail, o pedido aparece para o administrador, que clica em **Gerar senha temporária** e entrega à pessoa (confirme a identidade antes).
- Por segurança, a resposta da tela é sempre a mesma, exista o e-mail ou não — inclusive em **Criar conta** com um e-mail já cadastrado (nesse caso nenhum cadastro novo é criado nem aviso é enviado). Confira se o navegador não preencheu o e-mail sozinho.
- Os campos de senha têm um **ícone de olho** para mostrar/ocultar o que foi digitado.
- O menu **Usuários** mostra um número laranja quando há pedidos esperando.

### Segurança (só administrador)

Painel no estilo do Wordfence, no menu **Segurança** (o número vermelho no menu = eventos graves nas últimas 24 h):

- **Últimas 24 horas:** acessos, senhas erradas, força bruta, injeções, varreduras de robôs e acessos indevidos.
- **IPs bloqueados agora:** com o motivo e até quando; botão **Desbloquear**; formulário para **bloquear um IP** à mão (1 hora a 1 ano).
- **IPs mais suspeitos:** os endereços com mais eventos, com **Ver** e **Bloquear**.
- **Registro de eventos:** filtros por tipo, gravidade e IP; **Exportar (CSV)**.

| Evento | Quando acontece |
|---|---|
| Acesso | login certo |
| Senha errada | login que falhou |
| Força bruta | 5 senhas erradas seguidas no mesmo e-mail, ou 10 do mesmo IP em 15 min |
| Injeção | SQL (`' OR 1=1`, `UNION SELECT`), script (`<script>`), caminho de arquivo (`../`), comando do sistema — na URL ou em qualquer campo (inclusive senha) |
| Varredura (robô) | procura de `/wp-admin`, `/.env`, `/.git`, `/phpmyadmin`… |
| Acesso indevido / negado | licitante tentando abrir pregão de outra pessoa ou área de administrador |
| Excesso de pedidos | muitos cadastros ou pedidos de senha seguidos |
| Auditoria | usuário criado/alterado, senha redefinida, cadastro aprovado, IP bloqueado/desbloqueado, pregão excluído |

**Bloqueio automático:** 3 eventos graves do mesmo IP em 15 minutos (ou 10 senhas erradas) bloqueiam o IP por 1 hora. O **acesso local** (o computador onde o sistema roda) **nunca** é bloqueado automaticamente. Com o e-mail configurado, o administrador recebe um alerta (no máximo 1 por tipo a cada 30 min).

**Senhas nunca são gravadas no registro** — numa tentativa de injeção no campo de senha, aparece só o tipo do ataque. Os eventos ficam guardados por 90 dias.

### Significado dos status

| Status | Quer dizer |
|---|---|
| ✅ ATENDE | A proposta comprova o atendimento |
| ❌ NÃO ATENDE | A proposta mostra algo incompatível (ou, no modo rigoroso, não informa) |
| ⚪ NÃO COMPROVADO | A proposta não traz a informação (etiqueta **faltante**) |
| ⚠️ VAGO | Termo sem compromisso ("conforme estoque") |
| ⚠️ PARCIAL | Parte atende, parte não |
| 🔍 VERIFICAR EXTERNAMENTE | Conferir em fonte oficial (benchmark, data de lançamento, ficha técnica) |
| ✏️ REVISAR | As IAs divergiram, há alternativas ou conflito — precisa de uma pessoa |
| ✖ NÃO OFERTADO | O fornecedor não propôs aquele item/lote |

---

## 6. Atualizar para uma versão nova

Baixe o zip novo (pode salvar com qualquer nome que comece com `licitacoes`) e, no PowerShell:

```powershell
$zip = Get-ChildItem "$HOME\Downloads\licitacoes*.zip" | Sort-Object LastWriteTime | Select-Object -Last 1
$zip.Name   # confira se é o zip mais novo
Expand-Archive -Path $zip.FullName -DestinationPath "$HOME\Documents" -Force
cd "$HOME\Documents\licitacoes-spaguas"
powershell -ExecutionPolicy Bypass -File .\instalar.ps1
```

> **Sem o `-Limpar`!** Assim o `.env`, o New API, os modelos e todos os pregões ficam preservados. Espere uns 20 segundos (a API está subindo) e, no navegador, aperte **Ctrl+F5**.
>
> Se o `$zip.Name` mostrar vazio, o nome não bateu: veja os zips com `Get-ChildItem "$HOME\Downloads\licitacoes*.zip"` e use o nome exato em `Get-Item "$HOME\Downloads\NOME.zip"`.
>
> Se o README estiver aberto no VS Code durante a atualização, feche a aba **sem salvar** (não clique em "Substituir"), para ficar a versão nova.

---

## 7. Comandos úteis

Todos na pasta `Documentos\licitacoes-spaguas`:

| Para… | Comando |
|---|---|
| Ver o que está ligado | `docker compose ps` |
| Ver o log do sistema | `docker compose logs api --tail 50` |
| Acompanhar o log ao vivo | `docker compose logs -f api` (sair: Ctrl+C) |
| Log da leitura de PDFs | `docker compose logs pdf-worker --tail 50` |
| Reiniciar a API (depois de mudar o `.env`) | `docker compose up -d --force-recreate api` |
| Ver o que a API está lendo do `.env` | `docker compose exec api printenv SMTP_HOST` (troque pelo nome da variável) |
| Ver os envios de e-mail | `docker compose logs api --since 30m \| Select-String "e-mail"` |
| Testar o e-mail | `docker compose exec api node src/email-teste.js seu.email@dominio.gov.br` |
| Reiniciar as telas (nginx) | `docker compose restart frontend` |
| Trocar a senha do administrador | `powershell -ExecutionPolicy Bypass -File .\trocar-senha.ps1` |
| Configurar o e-mail | `powershell -ExecutionPolicy Bypass -File .\configurar-email.ps1` |
| Trocar o token do New API | `powershell -ExecutionPolicy Bypass -File .\definir-token.ps1 -Token sk-...` |
| Ver os modelos de IA local | `docker compose exec ollama ollama list` |
| Começar do zero (**apaga os dados deste sistema**) | `powershell -ExecutionPolicy Bypass -File .\instalar.ps1 -Limpar` |

---

## 8. Configurações do arquivo `.env`

O `.env` fica na pasta do projeto e **nunca** deve ser enviado para o Git nem mostrado em prints (tem senhas e o token). Depois de mudar qualquer linha: `docker compose up -d --force-recreate api`.

| Variável | Para que serve |
|---|---|
| `ADMIN_EMAIL` / `ADMIN_SENHA_INICIAL` | Login do administrador (a senha só vale na criação; para trocar, use `trocar-senha.ps1`) |
| `POSTGRES_PASSWORD`, `NEWAPI_DB_PASSWORD`, `APP_SECRET_KEY` | Senhas internas geradas pelo instalador — **não altere depois de instalado** |
| `NEWAPI_TOKEN` | Token do New API (use `definir-token.ps1`) |
| `ALIASES_SO_DOCUMENTOS_PUBLICOS` | IAs que **nunca** recebem propostas (padrão: `ia-leve`, o Gemini gratuito) |
| `ALIASES_NUVEM` | IAs na nuvem — propostas só vão **mascaradas** |
| `ROTA_E2_METADADOS` … `E6_SEGUNDA_OPINIAO` | Qual IA faz cada etapa (principal, reserva) |
| `LEVE_RPM`, `LEVE_RPD` | Limites por minuto e por dia do Gemini gratuito |
| `MEDIA_MAX_CONCURRENT`, `TIMEOUT_MEDIA_SEGUNDOS` | Chamadas simultâneas e tempo de espera da `ia-media` |
| `AUSENCIA_COMO_NAO_ATENDE` | Padrão da chave "informação ausente = NÃO ATENDE" para pregões novos |
| `LOCAL_TEXTOS` | Cidade no fecho dos textos de recusa ("São Paulo, 21 de outubro de 2026.") |
| `CAPITULOS_GERAIS_PALAVRAS`, `CAPITULOS_HABILITACAO_PALAVRAS` | Palavras dos capítulos do edital/TR com requisitos gerais e de habilitação |
| `OLLAMA_MODELO_LOCAL`, `EMBEDDINGS_MODELO`, `LIMIAR_DEPARA` | IA local e rede neural do de-para |
| `MAX_PDF_MB`, `OCR_ATIVO` | Tamanho máximo dos PDFs e leitura de PDF escaneado |
| `SMTP_HOST`, `SMTP_PORTA`, `SMTP_SEGURO`, `SMTP_USUARIO`, `SMTP_SENHA`, `SMTP_REMETENTE` | Envio de e-mails (seção 3.6) |
| `EMAIL_AVISOS_ADMIN` | Quem recebe os avisos de cadastro e os alertas de segurança |
| `APP_URL_PUBLICA` | Endereço do sistema usado nos links dos e-mails (troque quando for para um servidor) |
| `SEGURANCA_*` | Bloqueio automático de IP, limites e dias de histórico do monitor de segurança |

---

## 9. Segurança, dados e LGPD

- **Acesso só pelo seu computador:** as portas ficam presas a `127.0.0.1`. Ninguém da rede acessa o sistema nem o New API.
- **Login obrigatório** em todas as telas; a sessão expira em 12 horas; **Sair** encerra a sessão no servidor.
- **Perfis:** licitante só acessa os pregões que criou — o sistema confere o dono em **todas** as rotas (abrir, alterar, exportar, excluir), mesmo que alguém digite o endereço de outro pregão.
- **Senhas:** guardadas com *scrypt* (nunca em texto); mínimo de 8 caracteres com letras e números; senha temporária obrigatória de trocar.
- **Força bruta:** 5 senhas erradas seguidas bloqueiam aquele e-mail por 15 minutos. A mensagem de erro é a mesma para e-mail inexistente, senha errada ou usuário desativado.
- **Injeção de SQL:** todas as consultas usam parâmetros; códigos de registro que não sejam UUID são recusados antes de chegar ao banco.
- **Injeção de CSV:** textos que começam com `=`, `+`, `-` ou `@` são neutralizados nas planilhas exportadas.
- **Injeção de prompt:** as IAs são instruídas a tratar o conteúdo dos PDFs como dado, nunca como ordem; e tudo o que elas devolvem é conferido contra o documento.
- **Navegador:** cabeçalhos de segurança (CSP, proibição de abrir o sistema dentro de outro site, *nosniff*).
- **Proposta nunca vai para a IA gratuita** (Gemini) — só edital e TR, que são públicos.
- **Mascaramento LGPD:** antes de qualquer envio à nuvem, CPF, RG, telefone, e-mail e dados bancários são trocados por marcadores. O CNPJ da empresa é mantido.
- **Nada é inventado:** todo requisito e toda especificação têm o trecho literal conferido no documento.
- **PDFs de teste e `.env`** não devem ir para o Git (já estão no `.gitignore`).

---

## 10. Backup

Os dados ficam em volumes do Docker (sobrevivem a `docker compose down`, mas **não** a `instalar.ps1 -Limpar`).

**Fazer backup do banco do sistema:**

```powershell
docker compose exec -T postgres pg_dump -U licitacoes licitacoes > "backup-licitacoes-$(Get-Date -Format yyyyMMdd).sql"
```

**Restaurar** (num sistema recém-instalado):

```powershell
Get-Content .\backup-licitacoes-AAAAMMDD.sql | docker compose exec -T postgres psql -U licitacoes licitacoes
```

> Guarde também uma cópia do `.env` em local seguro.

---

## 11. Problemas comuns e soluções

| Sintoma | Causa provável | Solução |
|---|---|---|
| `docker` não é reconhecido / erro de conexão | Docker Desktop fechado | Abra o Docker Desktop e espere "Engine running" |
| "O argumento `.\instalar.ps1` não existe" | Está na pasta errada ou extraiu um zip antigo | `cd "$HOME\Documents\licitacoes-spaguas"` e `Get-ChildItem *.ps1` |
| "E-mail ou senha inválidos" | Senha diferente da criada, ou preenchimento automático | Digite à mão; se não lembrar, rode `trocar-senha.ps1` |
| "Muitas tentativas erradas" | 5 senhas erradas seguidas | Espere 15 minutos (ou peça ao administrador uma **Nova senha**) |
| "Acesso bloqueado temporariamente por segurança" | O IP foi bloqueado (automático ou manual) | Administrador: **Segurança → Desbloquear**. Emergência (sem conseguir entrar): `docker compose exec postgres psql -U licitacoes -d licitacoes -c "UPDATE bloqueios_ip SET ativo=false;"` |
| Licitante esqueceu a senha | — | Ele clica em **Esqueceu a senha?**; o administrador gera a senha em **Usuários** |
| "Seu cadastro está aguardando a aprovação" | Conta criada pela tela de login | Administrador: **Usuários → Aprovar** |
| "Muitos pedidos seguidos" | Vários cadastros ou pedidos de senha em pouco tempo | Espere alguns minutos |
| `configurar-email.ps1`: "O teste falhou" | Servidor, porta, usuário ou senha errados, ou a conta não pode enviar por SMTP | Confira com a TI; no Microsoft 365 a conta precisa ter **SMTP autenticado** liberado |
| Link do e-mail "inválido ou expirado" | Passaram 30 minutos ou o link já foi usado | Peça de novo em **Esqueceu a senha?** |
| `email-teste.js`: "E-mail não configurado" | Faltam as linhas `SMTP_*` no `.env`, ou a API não foi reiniciada | Seção 3.6; depois `docker compose up -d --force-recreate api` |
| `ENOTFOUND SMTP_HOST=smtp...` | A linha ficou com o nome repetido (`SMTP_HOST=SMTP_HOST=...`) | Deixe `SMTP_HOST=smtp.office365.com`, salve e reinicie a API |
| `535 ... Authentication unsuccessful` | Senha errada ou **SMTP autenticado** desligado na conta | TI ativa o SMTP autenticado no Microsoft 365 |
| E-mail "aceito pelo servidor" mas não chegou | Filtro de spam/quarentena | Procure no **Lixo Eletrônico**; TI confere a quarentena e libera o remetente |
| "Cadastro enviado" mas nenhum aviso | O e-mail já tinha cadastro (o navegador pode ter preenchido sozinho) | Cadastre com um e-mail que ainda não existe |
| "O sistema não está respondendo agora" (antigo "Erro 502") | A API estava reiniciando, ou o nginx guardou o endereço antigo da API | Espere 20 s e tente de novo; se continuar, `docker compose restart frontend` (versões novas corrigem sozinhas em até 10 s) |
| http://localhost:3000 ou :8080 "recusou a conexão" | Container desligado | `docker compose ps` e `docker compose up -d` |
| New API: "do request failed" no canal Ollama | Base URL errada ou modelo carregando | Base URL `http://ollama:11434`; rode `docker compose exec ollama ollama list` |
| New API: `503 high demand` no Gemini | Google sobrecarregado (temporário) | Espere alguns minutos; o sistema passa a tarefa para a reserva sozinho |
| New API: `404 ... no longer available` no Gemini | Modelo antigo | Use `gemini-3.5-flash-lite` no mapeamento |
| `definir-token.ps1`: "No available channel for model ... under group ..." | Canal sem o grupo do token, ou desligado | No canal: **Groups** igual ao do token e ícone **verde** |
| IA local (Qwen) muito lenta | Computador sem placa de vídeo | Use a DeepSeek como `ia-media` (seção 3.3, opção A) |
| Etapa com erro no pop-up | Falha de IA ou de leitura | Botão **Tentar de novo**; detalhes: `docker compose logs api --tail 50` |
| A tela continua com a versão antiga | Cache do navegador | **Ctrl+F5** |
| VS Code com faixa roxa "Modo Restrito" | Pasta não confiável | Clique em **Gerenciar → Confiar** |

---

## 12. Versionamento no GitHub da SP Águas

O código pode ficar na organização **spaguas** do GitHub, num repositório **privado** (peça ao administrador da organização para criar e dar acesso de escrita).

O que **nunca** vai para o Git (já está no `.gitignore`): o `.env` e suas cópias `.env.bak-*` (senhas), `node_modules/`, os arquivos enviados ao sistema e os PDFs reais de pregões (`docs/pdfs-de-teste/` — podem ter dados pessoais). Os dados de **teste** (gabaritos e PDFs sintéticos) vão, para os testes rodarem.

**Primeira vez** (com `winget install Git.Git` e `winget install GitHub.cli` instalados e `gh auth login` feito):

```powershell
cd "$HOME\Documents\licitacoes-spaguas"
git init
git add .
git status        # confira: .env NÃO pode aparecer
git commit -m "Sistema de Análise de Propostas: versão inicial"
git branch -M main
git remote add origin https://github.com/spaguas/NOME-DO-REPOSITORIO.git
git push -u origin main
```

**A cada atualização:** extraia o zip, rode o `instalar.ps1` e depois:

```powershell
git add .
git commit -m "Descreva a mudança"
git push
```

---

## 13. Estrutura do projeto

```
licitacoes-spaguas/
├─ docker-compose.yml     todos os serviços (banco, New API, Ollama, leitor de PDF, API, telas)
├─ .env.example           modelo de configuração (o instalador cria o .env a partir dele)
├─ instalar.ps1           instala/atualiza tudo
├─ definir-token.ps1      grava o token do New API e testa as IAs
├─ trocar-senha.ps1       troca a senha do administrador (recria o login de administrador)
├─ configurar-email.ps1   configura o envio de e-mails e manda um teste
├─ frontend/              telas em React + CSS (logos em frontend/public)
├─ backend/               API em Node.js: regras, IAs, banco, rotas e testes
├─ pdf-worker/            leitura dos PDFs em Python (MarkItDown, pdfplumber, Tesseract)
├─ fixtures/              gabaritos do Pregão 54/2026 usados nos testes
└─ docs/telas/            imagens das telas
```

### Serviços do Docker (projeto `licitacoes-spaguas`)

| Container | Função |
|---|---|
| `licit-frontend` | Telas (http://localhost:8080) |
| `licit-api` | API e regras de análise |
| `licit-pdf-worker` | Leitura dos PDFs e OCR |
| `licit-postgres` | Banco do sistema |
| `licit-new-api` + `licit-newapi-db` | Painel das IAs e o banco dele |
| `licit-ollama` | IA local (Qwen) e rede neural do de-para (bge-m3) |
| `licit-ollama-modelos` | Baixa os modelos na instalação e encerra (é normal ficar parado) |

---

## 14. Para quem vai programar

### Rodar as telas fora do Docker (vê cada alteração na hora)

Requer **Node.js 20+** (`winget install OpenJS.NodeJS.LTS`). Com o sistema ligado no Docker:

```powershell
cd "$HOME\Documents\licitacoes-spaguas\frontend"
npm install
npm run dev
```

Abra http://localhost:5173.

### Testes automáticos

Os testes não chamam IAs reais (usam respostas gravadas) e não gastam tokens. O fluxo completo usa os PDFs do Pregão 54/2026 (que **não** vão para o Git, porque têm dados pessoais).

```powershell
# backend (Node 20+)
cd backend
npm install
$env:PDFS_DIR = "C:\caminho\para\os\pdfs"; npm test

# leitor de PDF (Python 3.12 + requirements.txt)
cd ..\pdf-worker
pip install -r requirements.txt
$env:PDFS_DIR = "C:\caminho\para\os\pdfs"; python -m unittest discover -s testes -v
```

### Tecnologias

- **Telas:** React 18 + Vite, JavaScript e CSS puro
- **API:** Node.js 20 (sem frameworks; só o pacote `pg`)
- **Leitura de PDF:** Python 3.12 — MarkItDown, pdfplumber, Tesseract (OCR)
- **Banco:** PostgreSQL 16 · **IAs:** New API (Claude, Gemini, DeepSeek) e Ollama (Qwen, bge-m3)

### Limitações conhecidas

- Reprocessar o TR recria os requisitos (as validações anteriores se perdem).
- A rede neural do de-para usa o modelo pré-treinado; o ajuste fino com os exemplos exportados ainda não está pronto.
- Em editais por lote **sem** a coluna LOTE na tabela de itens, cada item vira um lote (o sistema avisa na Etapa 01).
