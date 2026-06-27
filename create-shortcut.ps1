# Get the directory of the script
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrEmpty($scriptDir)) {
    $scriptDir = Get-Location
}

$exeName = "steam-hltb-app.exe"
$exePath = Join-Path $scriptDir $exeName

# Check if the executable exists
if (-not (Test-Path $exePath)) {
    Write-Host "Warning: $exeName not found in $scriptDir. Please build the executable first using 'npm run build:exe'." -ForegroundColor Yellow
}

# Define the Desktop path and shortcut name
$desktopPath = [System.IO.Path]::Combine([System.Environment]::GetFolderPath('Desktop'), "Steam HLTB App.lnk")

try {
    Write-Host "Creating Desktop shortcut..." -ForegroundColor Cyan
    $WshShell = New-Object -ComObject WScript.Shell
    $Shortcut = $WshShell.CreateShortcut($desktopPath)
    $Shortcut.TargetPath = $exePath
    $Shortcut.WorkingDirectory = $scriptDir
    $Shortcut.Description = "Steam HowLongToBeat App"
    $Shortcut.Save()
    Write-Host "Shortcut successfully created at: $desktopPath" -ForegroundColor Green
} catch {
    Write-Error "Failed to create desktop shortcut: $_"
}
