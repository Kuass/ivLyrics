param(
    [string]$Uri = "ivlyrics-updater://update"
)

$ErrorActionPreference = "Stop"
$InstallerUrl = "https://raw.githubusercontent.com/ivLis-Studio/ivLyrics/main/updater/install.ps1"

function Get-IvLyricsUpdaterLocalAppDataDirectory {
    $knownFolderPath = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
    if (-not [string]::IsNullOrWhiteSpace($knownFolderPath) -and
        (Test-Path -LiteralPath $knownFolderPath -PathType Container -ErrorAction SilentlyContinue)) {
        return [IO.Path]::GetFullPath($knownFolderPath)
    }

    if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA) -and
        (Test-Path -LiteralPath $env:LOCALAPPDATA -PathType Container -ErrorAction SilentlyContinue)) {
        return [IO.Path]::GetFullPath($env:LOCALAPPDATA)
    }

    throw "Could not resolve the Windows Local AppData directory."
}

$UpdaterRoot = Join-Path (Get-IvLyricsUpdaterLocalAppDataDirectory) "ivLyrics\Updater"
$LogPath = Join-Path $UpdaterRoot "updater.log"

function Write-UpdaterLog {
    param([string]$Message)
    New-Item -ItemType Directory -Force -Path $UpdaterRoot | Out-Null
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
    Write-Host $Message
}

function Get-UpdaterAction {
    param([string]$RawUri)

    if ([string]::IsNullOrWhiteSpace($RawUri)) {
        return "update"
    }

    try {
        $parsed = [Uri]$RawUri
    }
    catch {
        throw "Invalid updater URI."
    }

    if ($parsed.Scheme -ne "ivlyrics-updater") {
        throw "Unsupported updater URI scheme."
    }

    $action = $parsed.Host
    if ([string]::IsNullOrWhiteSpace($action)) {
        $action = $parsed.AbsolutePath.Trim("/")
    }

    if ([string]::IsNullOrWhiteSpace($action)) {
        return "update"
    }

    $action = $action.ToLowerInvariant()
    switch ($action) {
        "update" { return "update" }
        "open-log" { return "open-log" }
        default { throw "Unsupported updater action: $action" }
    }
}

function Start-IvLyricsUpdate {
    Write-UpdaterLog "Starting ivLyrics update."

    # Keep the bootstrap installer under the canonical LocalAppData path rather
    # than TEMP, which can be a stale/nonexistent DOS 8.3 profile path.
    $tempRoot = Join-Path $UpdaterRoot ("Temp\" + [Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Force -Path $tempRoot -ErrorAction Stop | Out-Null
    $installerPath = Join-Path $tempRoot "install.ps1"

    try {
        Write-UpdaterLog "Downloading official installer."
        Invoke-WebRequest -UseBasicParsing -Uri $InstallerUrl -OutFile $installerPath

        Write-UpdaterLog "Running installer."
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installerPath
        if ($LASTEXITCODE -ne 0) {
            throw "Installer exited with code $LASTEXITCODE."
        }

        Write-UpdaterLog "ivLyrics update completed."
    }
    finally {
        if (Test-Path -LiteralPath $tempRoot -ErrorAction SilentlyContinue) {
            Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

try {
    $action = Get-UpdaterAction -RawUri $Uri

    switch ($action) {
        "update" {
            Start-IvLyricsUpdate
            Start-Sleep -Seconds 2
        }
        "open-log" {
            New-Item -ItemType Directory -Force -Path $UpdaterRoot | Out-Null
            if (-not (Test-Path -LiteralPath $LogPath)) {
                New-Item -ItemType File -Force -Path $LogPath | Out-Null
            }
            Start-Process notepad.exe -ArgumentList "`"$LogPath`""
        }
    }
}
catch {
    Write-UpdaterLog ("Update failed: " + $_.Exception.Message)
    Write-Host ""
    Write-Host "ivLyrics update failed. You can run the manual command instead:"
    Write-Host "iwr -useb https://raw.githubusercontent.com/ivLis-Studio/ivLyrics/main/updater/install.ps1 | iex"
    Write-Host ""
    Read-Host "Press Enter to close"
    exit 1
}
