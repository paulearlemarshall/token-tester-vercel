param(
  [switch] $NoElectron
)

$ErrorActionPreference = 'Stop'

function Normalize-ProcessPath {
  $pathValue = [Environment]::GetEnvironmentVariable('Path', 'Process')
  if (-not $pathValue) {
    $pathValue = [Environment]::GetEnvironmentVariable('PATH', 'Process')
  }

  if (-not $pathValue) {
    return
  }

  [Environment]::SetEnvironmentVariable('PATH', $null, 'Process')
  [Environment]::SetEnvironmentVariable('Path', $pathValue, 'Process')
}

Normalize-ProcessPath

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

if ($NoElectron) {
  node .\node_modules\vite\bin\vite.js --host 127.0.0.1
} else {
  node .\node_modules\vite\bin\vite.js
}
