<#
  Troca a senha do administrador do sistema.
  Uso (na pasta do projeto):  powershell -ExecutionPolicy Bypass -File .\trocar-senha.ps1
  Apaga só o(s) usuário(s); pregões, documentos e análises continuam salvos.
#>
$ErrorActionPreference = 'Continue'
Set-Location -Path $PSScriptRoot

if (-not (Test-Path .env)) { throw "Não encontrei o .env. Rode antes o instalar.ps1." }

do {
  $seguro = Read-Host "Digite a NOVA senha do administrador (mín. 8 caracteres, sem `$ e sem #)" -AsSecureString
  $senha = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro))
  $seguro2 = Read-Host "Digite a mesma senha de novo" -AsSecureString
  $senha2 = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro2))
  $valida = ($senha.Length -ge 8) -and (-not $senha.Contains('$')) -and (-not $senha.Contains('#')) -and ($senha -ceq $senha2)
  if (-not $valida) { Write-Host "As senhas não conferem ou não seguem as regras. Tente de novo." -ForegroundColor Yellow }
} while (-not $valida)

$linhas = (Get-Content .env -Encoding UTF8) -replace '^ADMIN_SENHA_INICIAL=.*', ("ADMIN_SENHA_INICIAL=" + $senha)
[System.IO.File]::WriteAllLines((Join-Path $PSScriptRoot '.env'), [string[]]$linhas, (New-Object System.Text.UTF8Encoding $false))

Write-Host "Recriando o administrador..." -ForegroundColor Cyan
docker compose exec -T postgres psql -U licitacoes -d licitacoes -c "DELETE FROM usuarios;" | Out-Null
docker compose up -d --force-recreate api | Out-Null

$criado = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 2
  if (docker compose logs api 2>&1 | Select-String "Administrador criado") { $criado = $true; break }
}
$email = (Get-Content .env -Encoding UTF8 | Where-Object { $_ -match '^ADMIN_EMAIL=' }) -replace '^ADMIN_EMAIL=', ''
if ($criado) {
  Write-Host ""
  Write-Host "Senha trocada. Entre em http://localhost:8080 com $email e a senha nova." -ForegroundColor Green
  Write-Host "Dica: DIGITE a senha (não use o preenchimento automático do navegador)." -ForegroundColor Green
} else {
  Write-Host "Não confirmei a criação. Veja: docker compose logs api --tail 30" -ForegroundColor Yellow
}
