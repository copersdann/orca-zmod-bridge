@echo off
powershell -NoProfile -Command "if (-not (Get-CimInstance Win32_Process -Filter \"name='node.exe'\" | Where-Object { $_.CommandLine -match 'orca-zmod-mcp\\src\\standalone-http' })) { Start-Process -FilePath 'node' -ArgumentList 'C:\tools\orca-zmod-mcp\src\standalone-http.js' -WorkingDirectory 'C:\tools\orca-zmod-mcp' -WindowStyle Hidden }"
