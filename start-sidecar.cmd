@echo off
powershell -NoProfile -Command "if (-not (Get-CimInstance Win32_Process -Filter \"name='node.exe'\" | Where-Object { $_.CommandLine -match 'standalone-http' })) { Start-Process -FilePath 'node' -ArgumentList 'C:\tools\mcp-hub\src\standalone-http.js' -WorkingDirectory 'C:\tools\mcp-hub' -WindowStyle Hidden }"
