$ErrorActionPreference = 'Stop'

try {
    $Root = $PSScriptRoot
    $Backend = Join-Path $Root 'backend'
    $Frontend = Join-Path $Root 'frontend'

    Write-Host "`n========== COMIND SOON ==========" -ForegroundColor Green

    # 1. Python
    Write-Host "`n[1/5] Python 3.14"

    $PythonExe = (& py -3.14 -c "import sys; print(sys.executable)" 2>$null | Select-Object -Last 1).Trim()

    if ($LASTEXITCODE -ne 0 -or !(Test-Path $PythonExe)) {
        throw "Системный Python 3.14 не найден."
    }

    & $PythonExe --version

    if ($LASTEXITCODE -ne 0) {
        throw "Python заблокирован или не запускается."
    }

    # 2. Node.js
    Write-Host "`n[2/5] Node.js"

    $NodeExe = $null

    $NodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue |
        Select-Object -First 1

    if ($NodeCommand) {
        $NodeExe = $NodeCommand.Source
    }

    if (!$NodeExe) {
        $NodeRoots = @(
            "$env:LOCALAPPDATA\Programs\COMIND-Node-24.22.2",
            "$env:LOCALAPPDATA\Programs\COMIND-Runtime"
        )

        foreach ($Folder in $NodeRoots) {
            if (Test-Path $Folder) {
                $Found = Get-ChildItem $Folder -Filter node.exe -File -Recurse `
                    -ErrorAction SilentlyContinue | Select-Object -First 1

                if ($Found) {
                    $NodeExe = $Found.FullName
                    break
                }
            }
        }
    }

    if (!$NodeExe) {
        throw "Node.js не найден."
    }

    $NodeDir = Split-Path $NodeExe
    $NpmCmd = Join-Path $NodeDir 'npm.cmd'
    $NpxCmd = Join-Path $NodeDir 'npx.cmd'

    if (!(Test-Path $NpmCmd)) {
        throw "npm.cmd не найден."
    }

    $env:PATH = "$NodeDir;$env:PATH"

    & $NodeExe --version
    & $NpmCmd --version

    # 3. Python-библиотеки
    Write-Host "`n[3/5] Python dependencies"

    & $PythonExe -m pip --version

    if ($LASTEXITCODE -ne 0) {
        & $PythonExe -m ensurepip --upgrade
        if ($LASTEXITCODE -ne 0) {
            throw "Не удалось подготовить pip."
        }
    }

    $Requirements = Join-Path $Backend 'requirements.txt'

    if (!(Test-Path $Requirements)) {
        throw "requirements.txt не найден."
    }

    & $PythonExe -m pip install --user -r $Requirements

    if ($LASTEXITCODE -ne 0) {
        throw "Ошибка установки Python-библиотек."
    }

    & $PythonExe -m pip install --user `
        'PyJWT>=2.8,<3' `
        'pwdlib[argon2]>=0.3,<1' `
        'email-validator>=2,<3' `
        'python-multipart>=0.0.9'

    if ($LASTEXITCODE -ne 0) {
        throw "Ошибка дополнительных Python-библиотек."
    }

    # Секретный ключ
    $EnvFile = Join-Path $Backend '.env'
    $Utf8 = New-Object System.Text.UTF8Encoding($false)

    if (!(Test-Path $EnvFile)) {
        [System.IO.File]::WriteAllText($EnvFile, '', $Utf8)
    }

    $EnvText = [System.IO.File]::ReadAllText($EnvFile)

    if ($EnvText -match '(?m)^\s*COMIND_SECRET_KEY\s*=\s*(.*?)\s*$') {
        $Secret = $Matches[1].Trim().Trim('"').Trim("'")
    } else {
        $Bytes = New-Object byte[] 48
        $Rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        $Rng.GetBytes($Bytes)
        $Rng.Dispose()

        $Secret = [Convert]::ToBase64String($Bytes).
            TrimEnd('=').Replace('+','-').Replace('/','_')

        [System.IO.File]::AppendAllText(
            $EnvFile,
            "`r`nCOMIND_SECRET_KEY=$Secret`r`n",
            $Utf8
        )
    }

    $env:COMIND_SECRET_KEY = $Secret
    $env:PYTHONUTF8 = '1'

    # Проверка импорта
    Push-Location $Backend
    try {
        & $PythonExe -c "import fastapi, uvicorn, jwt, pwdlib, email_validator; import app.main; print('BACKEND OK')"
        if ($LASTEXITCODE -ne 0) {
            throw "Backend import failed."
        }
    } finally {
        Pop-Location
    }

    # 4. Backend
    Write-Host "`n[4/5] Backend"

    $Ready = $false

    try {
        $Api = Invoke-RestMethod 'http://127.0.0.1:8000/openapi.json' -TimeoutSec 3
        if ($Api.info.title) {
            $Ready = $true
            Write-Host "Backend уже работает." -ForegroundColor Green
        }
    } catch {}

    if (!$Ready) {
        $Occupied = Get-NetTCPConnection -LocalPort 8000 -State Listen `
            -ErrorAction SilentlyContinue

        if ($Occupied) {
            throw "Порт 8000 занят."
        }

        $LogDir = Join-Path $Backend 'logs'
        New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

        $StdOut = Join-Path $LogDir 'backend-out.log'
        $StdErr = Join-Path $LogDir 'backend-error.log'

        $Process = Start-Process `
            -FilePath $PythonExe `
            -ArgumentList '-m uvicorn app.main:app --host 127.0.0.1 --port 8000' `
            -WorkingDirectory $Backend `
            -RedirectStandardOutput $StdOut `
            -RedirectStandardError $StdErr `
            -WindowStyle Hidden `
            -PassThru

        for ($i = 0; $i -lt 60; $i++) {
            Start-Sleep 1

            if ($Process.HasExited) { break }

            try {
                $Api = Invoke-RestMethod 'http://127.0.0.1:8000/openapi.json' -TimeoutSec 2
                if ($Api.info.title) {
                    $Ready = $true
                    break
                }
            } catch {}
        }

        if (!$Ready) {
            if (Test-Path $StdErr) {
                Get-Content $StdErr -Tail 40
            }
            throw "Backend не запустился."
        }
    }

    # 5. Frontend и Electron
    Write-Host "`n[5/5] Frontend и Electron"

    Push-Location $Frontend

    try {
        if (!(Test-Path 'node_modules\vite\bin\vite.js')) {
            Write-Host "Установка npm-библиотек..."

            if (Test-Path 'package-lock.json') {
                & $NpmCmd ci --no-audit --no-fund
            } else {
                & $NpmCmd install --no-audit --no-fund
            }

            if ($LASTEXITCODE -ne 0) {
                throw "Ошибка установки npm-библиотек."
            }
        }

        $ElectronExe = Join-Path $Frontend 'node_modules\electron\dist\electron.exe'

        if (!(Test-Path $ElectronExe)) {
            Write-Host "Загрузка Electron..."

            & $NpxCmd install-electron --no

            if ($LASTEXITCODE -ne 0 -or !(Test-Path $ElectronExe)) {
                throw "Electron не удалось загрузить. Проверьте интернет."
            }
        }

        Write-Host "`nЗапуск COMIND SOON..." -ForegroundColor Green

        & $NpmCmd run desktop

        if ($LASTEXITCODE -ne 0) {
            throw "Ошибка запуска Electron."
        }
    } finally {
        Pop-Location
    }

} catch {
    Write-Host "`nОШИБКА: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}