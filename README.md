# orca-zmod-bridge

Только OrcaSlicer + Z-Mod (Flashforge AD5X): локальный HTTP-мост и плагин с дашбордом
для OrcaSlicer. Никакого универсального MCP-хаба, сторонних серверов и прошивочных проектов.

## Возможности

- **Дашборд в OrcaSlicer** (вкладка `MCP Hub`): 5 разделов — Обзор, Принтер, Инструменты, Логи, Orca.
- График температур сопла/стола, статистика печати.
- Панель IFS/AFC: слоты, материалы, цвета, статусы и остаток филамента (из Moonraker).
- Управление принтером: статус, файлы, пауза/продолжить/отмена, G-code с двухшаговым подтверждением.
- История команд с повтором.
- Анализ STL/OBJ/3MF и G-code, список отчётов с экспортом.
- Слайсинг через OrcaSlicer CLI с профилями Flashforge; `--export-statistics`.
- Полный цикл «нарезать → проанализировать → загрузить/печать» с `confirm:true`.
- Spoolman, webhook-уведомления, локализация RU/EN.
- Автоанализ G-code после нарезки через `slicing_pipeline_plugin`.

## Установка

### 1. Фоновый HTTP-сервис

```powershell
cd C:\tools\orca-zmod-mcp
npm start                       # слушает 127.0.0.1:8765
node scripts/smoke.mjs          # проверка всех endpoint'ов
```

Для автозапуска — `start-sidecar.cmd` (или поместить его в `shell:Startup`).
Сервис доступен только на loopback. Порт меняется через `MCP_HUB_HTTP_PORT`.

Скопируй `flashforge.settings.example.json` → `flashforge.settings.json` и поправь:
- `printer.baseUrl` — адрес Moonraker, например `http://192.168.1.183:7125`;
- `slicer.command` — путь к `orca-slicer.exe`;
- при необходимости `spoolman.baseUrl` и `notifications.webhookUrl`.

`flashforge.settings.json` в репозиторий не коммитится.

### 2. Плагин OrcaSlicer

```
plugins/orca/mcp_hub_bridge.py
  → %APPDATA%\OrcaSlicer\orca_plugins\mcp_hub_bridge\mcp_hub_bridge.py
```

Перезапусти OrcaSlicer → `File > Plugins` → включи **MCP Hub Bridge** →
подтверди разрешения на `http://127.0.0.1:8765` и создание потока.
Появится вкладка **MCP Hub**.

### 3. Z-Mod на принтере

Веб-интерфейс: `http://<ip_printer>/` (без HTTPS). Moonraker: `http://<ip_printer>:7125`.
Для AD5X после установки Z-Mod включи `AFC=1`, `USE_KAMP=1`, `FORCE_MD5=1`;
в Orca используй Host Type `Octo/Klipper`, Printer Agent `Moonraker`.

## Эндпоинты

| Endpoint | Назначение |
|---|---|
| `GET /health`, `GET /diagnostics` | состояние сервиса и проверки |
| `GET /settings`, `POST /settings` | Spoolman / webhook |
| `GET /printer/status`, `/printer/afc`, `/printer/probe` | Moonraker |
| `POST /printer/command`, `/printer/action` | G-code и управление (confirm:true) |
| `GET /profiles`, `/orca/presets`, `/orca/info`, `/orca/events` | Orca |
| `POST /model/inspect`, `/gcode/analyze`, `/slice/done` | анализ |
| `GET /reports`, `/reports/get`, `/reports/export` | отчёты |
| `POST /plugin/event`, `GET /plugin/events` | lifecycle-события |
| `GET /spoolman/spools`, `POST /notify/send` | интеграции |
| `GET /hub/tools` | каталог встроенных инструментов |
| `POST /workflow/slice_print` | слайсинг → печать |

## Безопасность

- только `127.0.0.1`;
- мутирующие команды принтера требуют `confirm:true`;
- токены и `flashforge.settings.json` исключены из git;
- плагин отвергает не-loopback адреса.

## Проверки

```
npm run check
node scripts/smoke.mjs
python -m py_compile plugins/orca/mcp_hub_bridge.py
```
