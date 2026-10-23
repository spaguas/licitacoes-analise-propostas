<#
  Coloca o token do New API no .env, reinicia a API e testa as três IAs.
  Uso: powershell -ExecutionPolicy Bypass -File .\definir-token.ps1 -Token sk-SEU-TOKEN
#>
param([Parameter(Mandatory = $true)][string]$Token)

# 'Continue': no PowerShell 5.1, avisos do Docker no canal de erro derrubariam o script com 'Stop'.
# Os erros de verdade são conferidos pelo código de saída ($LASTEXITCODE) e interrompidos com 'throw'.
$ErrorActionPreference = 'Continue'
Set-Location -Path $PSScriptRoot
$Utf8SemBom = New-Object System.Text.UTF8Encoding $false

if (-not $Token.StartsWith("sk-")) { throw "O token do New API começa com 'sk-'. Copie em API Keys, no painel http://localhost:3000." }
if (-not (Test-Path .env)) { throw "Não encontrei o .env. Rode antes o instalar.ps1." }

$linhas = Get-Content .env -Encoding UTF8
$linhas = $linhas -replace '^NEWAPI_TOKEN=.*', ("NEWAPI_TOKEN=" + $Token)
[System.IO.File]::WriteAllLines((Join-Path $PSScriptRoot '.env'), [string[]]$linhas, $Utf8SemBom)
Write-Host "Token gravado no .env." -ForegroundColor Green

Write-Host "Reiniciando a API para ela ler o token..." -ForegroundColor Cyan
docker compose up -d --force-recreate api
if ($LASTEXITCODE -ne 0) { throw "Falha ao reiniciar a API." }

Write-Host ""
Write-Host "Testando as três IAs pelo New API (a ia-media pode levar 1 a 2 minutos na 1ª vez)..." -ForegroundColor Cyan
$falhas = 0
foreach ($modelo in @("ia-leve", "ia-media", "ia-forte")) {
  $corpo = @{ model = $modelo; messages = @(@{ role = "user"; content = "Responda apenas: ok" }) } | ConvertTo-Json -Depth 5
  try {
    $r = Invoke-RestMethod -Uri "http://localhost:3000/v1/chat/completions" -Method Post -TimeoutSec 300 -ErrorAction Stop `
      -Headers @{ Authorization = "Bearer $Token" } -ContentType "application/json" -Body $corpo
    Write-Host ("  {0,-9} OK  -> {1}" -f $modelo, $r.choices[0].message.content.Trim()) -ForegroundColor Green
  } catch {
    $falhas++
    $detalhe = $_.ErrorDetails.Message
    if (-not $detalhe) { $detalhe = $_.Exception.Message }
    Write-Host ("  {0,-9} ERRO -> {1}" -f $modelo, $detalhe) -ForegroundColor Red
  }
}
Write-Host ""
if ($falhas -eq 0) {
  Write-Host "Tudo pronto. Abra http://localhost:8080 e use o sistema." -ForegroundColor Green
} else {
  Write-Host "Confira no New API os canais das IAs com erro: o apelido precisa estar em 'Models' e no 'Model Mapping', e o canal no grupo 'default'." -ForegroundColor Yellow
}
