<#
  Configura o envio de e-mails do sistema (esqueci a senha, avisos de cadastro e de aprovação).
  Uso (na pasta do projeto):  powershell -ExecutionPolicy Bypass -File .\configurar-email.ps1
  A senha é digitada sem aparecer na tela e fica só no arquivo .env deste computador.
#>
$ErrorActionPreference = 'Continue'
Set-Location -Path $PSScriptRoot
if (-not (Test-Path .env)) { throw "Não encontrei o .env. Rode antes o instalar.ps1." }

function Perguntar($texto, $padrao) {
  $r = Read-Host "$texto [$padrao]"
  if ([string]::IsNullOrWhiteSpace($r)) { return $padrao } else { return $r.Trim() }
}

Write-Host ""
Write-Host "Dados do servidor de e-mail (peça à TI da SP Águas se não souber)." -ForegroundColor Cyan
Write-Host "  Microsoft 365 / Outlook: smtp.office365.com, porta 587" -ForegroundColor DarkGray
Write-Host "  Google Workspace:        smtp.gmail.com, porta 587" -ForegroundColor DarkGray
Write-Host ""
$hostSmtp  = Perguntar "Servidor SMTP" "smtp.office365.com"
$porta     = Perguntar "Porta (587 = STARTTLS; 465 = TLS direto)" "587"
$usuario   = Perguntar "Usuário (conta que envia)" "no-reply@spaguas.sp.gov.br"
$seguro    = Read-Host "Senha dessa conta (não aparece na tela)" -AsSecureString
$senha     = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro))
$remetente = Perguntar "Remetente (aparece como 'De:')" $usuario
$avisos    = Perguntar "E-mail que recebe os avisos de cadastro" "renata.machado@apoiospaguas.sp.gov.br"
$url       = Perguntar "Endereço do sistema usado nos links" "http://localhost:8080"

if ($senha.Contains("'")) { throw "A senha tem aspas simples ('), que o .env não aceita. Peça outra senha à TI." }
$tls = if ($porta -eq "465") { "true" } else { "false" }

$valores = [ordered]@{
  "SMTP_HOST" = $hostSmtp; "SMTP_PORTA" = $porta; "SMTP_SEGURO" = $tls; "SMTP_USUARIO" = $usuario
  "SMTP_SENHA" = "'$senha'"; "SMTP_REMETENTE" = $remetente; "EMAIL_AVISOS_ADMIN" = $avisos; "APP_URL_PUBLICA" = $url
}
$linhas = [System.Collections.Generic.List[string]](Get-Content .env -Encoding UTF8)
foreach ($chave in $valores.Keys) {
  $nova = "$chave=$($valores[$chave])"
  $i = $linhas.FindIndex({ param($l) $l -match "^$chave=" })
  if ($i -ge 0) { $linhas[$i] = $nova } else { $linhas.Add($nova) }
}
[System.IO.File]::WriteAllLines((Join-Path $PSScriptRoot '.env'), [string[]]$linhas, (New-Object System.Text.UTF8Encoding $false))
$senha = $null
Write-Host "Configuração gravada no .env." -ForegroundColor Green

Write-Host "Reiniciando a API para ela ler o e-mail..." -ForegroundColor Cyan
docker compose up -d --force-recreate api | Out-Null
Start-Sleep -Seconds 8

Write-Host "Enviando um e-mail de teste para $avisos ..." -ForegroundColor Cyan
docker compose exec -T api node src/email-teste.js $avisos
if ($LASTEXITCODE -eq 0) {
  Write-Host ""
  Write-Host "Tudo certo. Confira a caixa de entrada de $avisos (e o spam)." -ForegroundColor Green
} else {
  Write-Host ""
  Write-Host "O teste falhou. Confira servidor, porta, usuário e senha com a TI e rode este script de novo." -ForegroundColor Yellow
  Write-Host "Se a TI disser que o servidor usa certificado próprio, acrescente SMTP_IGNORAR_CERTIFICADO=true no .env." -ForegroundColor Yellow
}
