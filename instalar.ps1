<#
  Instalador do sistema de análise de propostas — SP Águas
  Uso (na pasta do projeto):
      powershell -ExecutionPolicy Bypass -File .\instalar.ps1            # instala ou atualiza, mantendo os dados
      powershell -ExecutionPolicy Bypass -File .\instalar.ps1 -Limpar    # começa do zero (apaga dados deste projeto)
#>
param([switch]$Limpar)

# 'Continue': no PowerShell 5.1, avisos do Docker no canal de erro derrubariam o script com 'Stop'.
# Os erros de verdade são conferidos pelo código de saída ($LASTEXITCODE) e interrompidos com 'throw'.
$ErrorActionPreference = 'Continue'
Set-Location -Path $PSScriptRoot
$Utf8SemBom = New-Object System.Text.UTF8Encoding $false

function Passo([string]$texto) { Write-Host ""; Write-Host "==> $texto" -ForegroundColor Cyan }
function Ok([string]$texto) { Write-Host "    $texto" -ForegroundColor Green }
function Aviso([string]$texto) { Write-Host "    $texto" -ForegroundColor Yellow }
function NovaSenha([int]$tamanho) {
  -join ((48..57) + (65..90) + (97..122) | Get-Random -Count $tamanho | ForEach-Object { [char]$_ })
}

# ------------------------------------------------------------------ 1. Docker
Passo "Conferindo o Docker"
docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "O Docker Desktop não está aberto. Abra o Docker Desktop, espere ficar verde e rode de novo." }
Ok "Docker funcionando."

# ------------------------------------------------------------------ 2. Portas ocupadas por outros projetos
Passo "Liberando as portas 3000, 3001 e 8080"
$ocupantes = docker ps --format "{{.Names}}|{{.Ports}}" | Where-Object { $_ -match ':(3000|3001|8080)->' -and $_ -notmatch '^licit-' }
foreach ($linha in $ocupantes) {
  $nome = $linha.Split('|')[0]
  Aviso "Parando o container '$nome' de outro projeto (ele usa uma porta deste sistema)."
  docker stop $nome *> $null
}
Ok "Portas livres."

# ------------------------------------------------------------------ 3. Começar do zero (opcional)
if ($Limpar) {
  Passo "Começando do zero: apagando containers e dados DESTE projeto"
  docker compose down -v --remove-orphans
  # Containers que sobraram de tentativas anteriores (mesmo nome, outro projeto)
  docker ps -a --format "{{.Names}}" | Where-Object { $_ -like 'licit-*' } | ForEach-Object { docker rm -f $_ *> $null }
  if (Test-Path .env) {
    $copia = ".env.bak-" + (Get-Date -Format "yyyyMMdd-HHmmss")
    Move-Item .env $copia
    Aviso "O .env antigo foi guardado como $copia"
  }
}

# ------------------------------------------------------------------ 4. Arquivo .env
Passo "Preparando o arquivo .env"
if (Test-Path .env) {
  Ok ".env já existe: mantendo as configurações atuais."
} else {
  do {
    $seguro = Read-Host "Crie a senha do ADMINISTRADOR do sistema (mín. 8 caracteres, sem o símbolo `$)" -AsSecureString
    $senha = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro))
    $valida = ($senha.Length -ge 8) -and (-not $senha.Contains('$')) -and (-not $senha.Contains('#'))
    if (-not $valida) { Aviso "Senha inválida: use pelo menos 8 caracteres e não use os símbolos `$ ou #." }
  } while (-not $valida)

  $linhas = Get-Content .env.example -Encoding UTF8
  $linhas = $linhas -replace '^APP_SECRET_KEY=.*', ("APP_SECRET_KEY=" + (NovaSenha 48))
  $linhas = $linhas -replace '^ADMIN_SENHA_INICIAL=.*', ("ADMIN_SENHA_INICIAL=" + $senha)
  $linhas = $linhas -replace '^POSTGRES_PASSWORD=.*', ("POSTGRES_PASSWORD=" + (NovaSenha 24))
  $linhas = $linhas -replace '^NEWAPI_DB_PASSWORD=.*', ("NEWAPI_DB_PASSWORD=" + (NovaSenha 24))
  [System.IO.File]::WriteAllLines((Join-Path $PSScriptRoot '.env'), [string[]]$linhas, $Utf8SemBom)
  Ok ".env criado com senhas novas (o token do New API entra depois, com o definir-token.ps1)."
}

# ------------------------------------------------------------------ 5. Containers
Passo "Construindo e ligando os containers (na 1ª vez demora alguns minutos)"
docker compose up -d --build
if ($LASTEXITCODE -ne 0) { throw "Falha ao subir os containers. Veja as mensagens acima." }
Ok "Containers ligados."

# ------------------------------------------------------------------ 6. Modelos do Ollama
Passo "Baixando os modelos de IA local (Qwen e bge-m3, cerca de 5 GB na 1ª vez)"
$inicio = Get-Date
while ($true) {
  $estado = docker inspect -f "{{.State.Status}} {{.State.ExitCode}}" licit-ollama-modelos 2>$null
  if ($estado -like "exited 0*") { Ok "Modelos prontos."; break }
  if ($estado -like "exited*") {
    docker logs --tail 20 licit-ollama-modelos
    throw "O download dos modelos falhou. Confira a internet e rode o instalador de novo."
  }
  $ultima = docker logs --tail 1 licit-ollama-modelos 2>&1 | Select-Object -Last 1
  $minutos = [int]((Get-Date) - $inicio).TotalMinutes
  Write-Host ("    ainda baixando ({0} min)... {1}" -f $minutos, $ultima)
  Start-Sleep -Seconds 15
}

# ------------------------------------------------------------------ 7. Aplicação respondendo
Passo "Esperando a aplicação responder"
$pronto = $false
for ($i = 0; $i -lt 60; $i++) {
  try {
    $r = Invoke-RestMethod -Uri "http://localhost:8080/api/saude" -TimeoutSec 5 -ErrorAction Stop
    if ($r.status -eq "ok") { $pronto = $true; break }
  } catch { Start-Sleep -Seconds 5 }
}
if (-not $pronto) {
  docker compose logs --tail 30 api
  throw "A aplicação não respondeu. Veja o log acima."
}
Ok "Aplicação no ar."

# ------------------------------------------------------------------ 8. Resumo
$email = (Get-Content .env -Encoding UTF8 | Where-Object { $_ -match '^ADMIN_EMAIL=' }) -replace '^ADMIN_EMAIL=', ''
Write-Host ""
Write-Host "==================================================================" -ForegroundColor Green
Write-Host " Instalação concluída" -ForegroundColor Green
Write-Host "==================================================================" -ForegroundColor Green
Write-Host " Aplicação:  http://localhost:8080   (login: $email + a senha que você criou)"
Write-Host " New API:    http://localhost:3000   (painel das IAs)"
Write-Host ""
Write-Host " PRÓXIMOS PASSOS:"
Write-Host "  1. No New API, faça o assistente inicial e crie os 3 canais:"
Write-Host "       Claude  -> apelido ia-forte -> claude-sonnet-5-5"
Write-Host "       Gemini  -> apelido ia-leve  -> modelo Flash-Lite gratuito"
Write-Host "       Ollama  -> Base URL http://ollama:11434 -> apelido ia-media -> qwen3.5:4b"
Write-Host "  2. Em API Keys, crie o token (grupo default, cota ilimitada) e rode:"
Write-Host "       powershell -ExecutionPolicy Bypass -File .\definir-token.ps1 -Token sk-SEU-TOKEN"
Write-Host ""
