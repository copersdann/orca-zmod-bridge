# /// script
# requires-python = ">=3.12"
# dependencies = []
#
# [tool.orcaslicer.plugin]
# name = "MCP Hub Bridge"
# description = "Современный дашборд MCP Hub, автоанализ G-code и журнал событий для OrcaSlicer."
# author = "OpenCode"
# version = "4.0.0"
# ///
"""Плагин OrcaSlicer: дашборд и мост к локальному orca-zmod-bridge (v4)."""
import json
import threading
import urllib.parse
import urllib.request

import orca

DEFAULT_HOST = "http://127.0.0.1:8765"
PERMISSION_URLS = [
    DEFAULT_HOST + "/health",
    DEFAULT_HOST + "/diagnostics",
    DEFAULT_HOST + "/printer/status",
    DEFAULT_HOST + "/printer/afc",
    DEFAULT_HOST + "/printer/command",
    DEFAULT_HOST + "/printer/action",
    DEFAULT_HOST + "/printer/probe",
    DEFAULT_HOST + "/model/inspect",
    DEFAULT_HOST + "/gcode/analyze",
    DEFAULT_HOST + "/slice/done",
    DEFAULT_HOST + "/reports/list",
    DEFAULT_HOST + "/reports/get",
    DEFAULT_HOST + "/reports/export",
    DEFAULT_HOST + "/plugin/event",
    DEFAULT_HOST + "/plugin/events/list",
    DEFAULT_HOST + "/profiles/search",
    DEFAULT_HOST + "/hub/tools/search",
    DEFAULT_HOST + "/orca/info",
    DEFAULT_HOST + "/orca/presets/search",
    DEFAULT_HOST + "/orca/events/list",
    DEFAULT_HOST + "/spoolman/spools",
    DEFAULT_HOST + "/notify/send",
    DEFAULT_HOST + "/settings",
    DEFAULT_HOST + "/workflow/slice_print",
]


def _cfg(capability, extra=None):
    defaults = {"host": DEFAULT_HOST, "enabled": True, "refreshSeconds": 5, "autoRefresh": True, "logLifecycleEvents": True}
    if extra:
        defaults.update(extra)
    try:
        stored = json.loads(capability.get_config() or "{}")
    except Exception:
        stored = {}
    if not isinstance(stored, dict):
        stored = {}
    defaults.update(stored)
    return defaults


def _safe_base(capability):
    cfg = _cfg(capability)
    base = str(cfg.get("host", DEFAULT_HOST)).strip().rstrip("/")
    if not (base.startswith("http://127.0.0.1") or base.startswith("http://localhost")):
        raise ValueError("Только loopback-адрес: http://127.0.0.1:8765")
    return base


def _api(capability, method, endpoint, payload=None, timeout=4.0):
    try:
        url = _safe_base(capability) + endpoint
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        req = urllib.request.Request(
            url, data=data,
            headers={"Content-Type": "application/json"} if data else {},
            method=method,
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", "replace")
            try:
                return True, json.loads(body)
            except Exception:
                return True, {"text": body[:4000]}
    except Exception as exc:
        return False, {"error": str(exc)}


def _api_async(capability, done, method, endpoint, payload=None, timeout=6.0):
    def worker():
        ok, data = _api(capability, method, endpoint, payload, timeout)
        try:
            done(ok, data)
        except Exception as exc:
            try:
                done(False, {"error": "callback: " + str(exc)})
            except Exception:
                pass
    threading.Thread(target=worker, daemon=True).start()


def _event_name(event):
    return str(getattr(event, "name", event))


def _model_summary():
    try:
        model = orca.host.model()
        objects = list(model.objects())
        volumes = []
        for obj in objects:
            for vol in obj.volumes():
                mesh = vol.mesh()
                volumes.append({
                    "name": str(getattr(vol, "name", "")),
                    "triangles": mesh.triangle_count(),
                    "volumeMm3": round(float(mesh.volume()), 2),
                    "manifold": bool(mesh.is_manifold()),
                })
        return {"objects": len(objects), "volumes": volumes[:12]}
    except Exception as exc:
        return {"error": str(exc)}


PAGE = r"""
<style>
  .mh-root { font-family: var(--orca-font); font-size: 13px; color: var(--orca-fg); padding: 10px 12px 26px; }
  .mh-head { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:12px; }
  .mh-logo { font-size:15px; font-weight:700; letter-spacing:.2px; }
  .mh-dot { font-size:11px; padding:2px 8px; border-radius:999px; border:1px solid var(--orca-border); }
  .mh-dot.on { color:#2ecc71; border-color:#2ecc71; }
  .mh-dot.off { color:#e74c3c; border-color:#e74c3c; }
  .mh-nav { display:flex; gap:4px; flex-wrap:wrap; padding-bottom:8px; border-bottom:1px solid var(--orca-border); margin-bottom:12px; }
  .mh-nav button { background:transparent; border:1px solid transparent; border-radius:8px; padding:6px 12px; cursor:pointer; color:var(--orca-muted); }
  .mh-nav button.active { color:var(--orca-accent); border-color:var(--orca-accent); background:var(--orca-bg); font-weight:600; }
  .mh-page { display:none; }
  .mh-page.active { display:block; }
  .mh-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:12px; }
  .mh-card { border:1px solid var(--orca-border); border-radius:12px; padding:12px 14px; margin-bottom:12px; }
  .mh-card h3 { margin:0 0 8px; font-size:13px; font-weight:700; letter-spacing:.3px; text-transform:uppercase; color:var(--orca-muted); }
  .mh-kv { display:grid; grid-template-columns:120px 1fr; gap:4px 10px; align-items:start; }
  .mh-kv span:nth-child(odd) { color:var(--orca-muted); }
  .mh-badge { display:inline-block; padding:2px 8px; border-radius:999px; border:1px solid var(--orca-border); margin:2px 4px 2px 0; font-size:11px; }
  .mh-badge.good { color:#2ecc71; border-color:#2ecc71; }
  .mh-badge.warn { color:#f39c12; border-color:#f39c12; }
  .mh-badge.bad { color:#e74c3c; border-color:#e74c3c; }
  .mh-row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin:8px 0; }
  .mh-row input[type=text] { flex:1; min-width:180px; }
  .mh-actions button { border-radius:8px; border:1px solid var(--orca-border); padding:6px 11px; cursor:pointer; background:transparent; color:var(--orca-fg); }
  .mh-actions button:hover { border-color:var(--orca-accent); color:var(--orca-accent); }
  .mh-actions button.primary { border-color:var(--orca-accent); color:var(--orca-accent); }
  .mh-pre { white-space:pre-wrap; word-break:break-word; font-family:monospace; font-size:11px; max-height:260px; overflow:auto; margin:6px 0 0; }
  .mh-muted { color:var(--orca-muted); font-size:11px; }
  .mh-toast { position:sticky; top:4px; z-index:5; margin-bottom:8px; display:flex; flex-direction:column; gap:6px; }
  .mh-toast div { border:1px solid var(--orca-border); border-radius:8px; padding:7px 10px; background:var(--orca-bg); }
  .mh-toast .ok { border-color:#2ecc71; } .mh-toast .err { border-color:#e74c3c; }
  .mh-load { color:var(--orca-accent); }
  .mh-list { max-height:220px; overflow:auto; }
  .mh-list div { border-bottom:1px solid var(--orca-border); padding:5px 2px; cursor:pointer; }
  details.mh-card summary { cursor:pointer; color:var(--orca-muted); }
</style>
<div class="mh-root">
  <div class="mh-toast" id="mh-toast"></div>
  <div class="mh-head">
    <span class="mh-logo">MCP Hub Bridge</span>
    <span class="mh-dot" id="mh-dot">подключение…</span>
    <span class="mh-muted" id="mh-time"></span>
    <span style="flex:1"></span>
    <div class="mh-actions">
      <button id="mh-refresh" class="primary">Обновить</button>
      <button id="mh-doctor">Диагностика</button>
      <button id="mh-settings-btn" title="Настройки">⚙ Настройки</button>
    </div>
  </div>
  <div class="mh-nav" id="mh-nav">
    <button data-tab="dash" class="active">Обзор</button>
    <button data-tab="control">Принтер</button>
    <button data-tab="tools">Инструменты</button>
    <button data-tab="logs">Логи</button>
    <button data-tab="orca">Orca</button>
  </div>

  <div class="mh-page active" id="page-dash">
    <div class="mh-grid">
      <div class="mh-card">
        <h3>Хаб</h3>
        <div class="mh-kv" id="mh-health-kv"><span class="mh-load">загрузка…</span></div>
        <details><summary>RAW</summary><pre class="mh-pre" id="mh-health-raw"></pre></details>
      </div>
      <div class="mh-card">
        <h3>Принтер</h3>
        <div class="mh-kv" id="mh-printer-kv"><span class="mh-load">загрузка…</span></div>
        <div id="mh-printer-badges"></div>
        <details><summary>RAW</summary><pre class="mh-pre" id="mh-printer-raw"></pre></details>
      </div>
      <div class="mh-card">
        <h3>Температуры / печать</h3>
      <svg id="mh-chart" viewBox="0 0 320 90" preserveAspectRatio="none" style="width:100%;height:90px;border:1px solid var(--orca-border);border-radius:8px"></svg>
      <div class="mh-kv" id="mh-print-stats"></div>
    </div>
  </div>
  </div>

  <div class="mh-page" id="page-control">
    <div class="mh-card">
      <h3>Управление принтером</h3>
      <div class="mh-actions" id="mh-quick">
        <button data-a="status" title="Только чтение">ⓘ Статус</button>
        <button data-a="files" title="Только чтение">📁 Файлы</button>
        <button data-a="gcode" data-cmd="G28" title="Homing">⌂ Homing</button>
        <button data-a="gcode" data-cmd="M106 S255" title="Вентилятор вкл">🌀 Fan on</button>
        <button data-a="gcode" data-cmd="M107" title="Вентилятор выкл">🌀 Fan off</button>
        <button data-a="gcode" data-cmd="M104 S200" title="Нагрев сопла">♨ Сопло 200°</button>
        <button data-a="gcode" data-cmd="M140 S60" title="Нагрев стола">♨ Стол 60°</button>
        <button data-a="photo" title="Снимок камеры">📷 Камера</button>
        <button data-a="pause">⏸ Пауза</button>
        <button data-a="resume">▶ Продолжить</button>
        <button data-a="cancel" class="primary">⏹ Отмена печати</button>
      </div>
      <div class="mh-muted" style="margin-top:6px">Кнопки с G-code и управлением требуют двойного нажатия (второе — подтверждение).</div>
    </div>
    <div class="mh-card">
      <h3>Отправка G-code</h3>
      <div class="mh-row"><input type="text" id="mh-cmd" placeholder="M105" /><button id="mh-preview" class="primary">Предпросмотр</button><button id="mh-send">Подтвердить</button></div>
      <div class="mh-muted">Сначала предпросмотр — только потом отправка.</div>
      <pre class="mh-pre" id="mh-cmd-result"></pre>
    </div>
    <div class="mh-card">
      <h3>Поиск принтера в сети</h3>
      <div class="mh-row"><input type="text" id="mh-subnet" placeholder="192.168.1 (авто)" /><button id="mh-probe">Сканировать /24</button></div>
      <pre class="mh-pre" id="mh-probe-result"></pre>
    </div>
    <div class="mh-card">
      <h3>IFS / AFC — слоты</h3>
      <div class="mh-actions"><button id="mh-afc-refresh">Обновить слоты</button></div>
      <div class="mh-grid" id="mh-afc-lanes" style="margin-top:8px"></div>
    </div>
    <div class="mh-card">
      <h3>История команд</h3>
      <div class="mh-list" id="mh-cmd-history"><div class="mh-muted">Пока пусто</div></div>
    </div>
  </div>

  <div class="mh-page" id="page-tools">
    <div class="mh-grid">
      <div class="mh-card">
        <h3>Проверка модели</h3>
        <div class="mh-row"><input type="text" id="mh-model-path" placeholder="Путь к STL / 3MF" /><input type="text" id="mh-model-volume" placeholder="220x220x220" style="max-width:130px" /><button id="mh-model-check" class="primary">Проверить</button></div>
        <pre class="mh-pre" id="mh-model-result"></pre>
      </div>
      <div class="mh-card">
        <h3>Анализ G-code</h3>
        <div class="mh-row"><input type="text" id="mh-gcode-path" placeholder="Путь к .gcode" /><button id="mh-gcode-check" class="primary">Анализировать</button></div>
        <pre class="mh-pre" id="mh-gcode-result"></pre>
      </div>
    </div>
    <div class="mh-card">
      <h3>Профили и инструменты</h3>
      <div class="mh-row">
        <select id="mh-profile-kind"><option value="all">все</option><option value="machine">машины</option><option value="process">процессы</option><option value="filament">филаменты</option></select>
        <input type="text" id="mh-profile-query" placeholder="AD5X, PETG…" />
        <button id="mh-profiles">Найти профили</button>
      </div>
      <pre class="mh-pre" id="mh-profiles-result"></pre>
      <div class="mh-row"><input type="text" id="mh-tool-query" placeholder="screenshot, issue…" /><button id="mh-tools">Инструменты</button></div>
      <pre class="mh-pre" id="mh-tools-result"></pre>
    </div>
    <div class="mh-card">
      <h3>Одна кнопка: нарезать → анализ → печать</h3>
      <div class="mh-row"><input type="text" id="mh-wf-input" placeholder="Путь к STL / 3MF" /><input type="text" id="mh-wf-outdir" placeholder="Папка вывода" style="max-width:220px" /></div>
      <div class="mh-row"><input type="text" id="mh-wf-machine" placeholder="Z-Mod Flashforge AD5X 0.4 nozzle" /><input type="text" id="mh-wf-process" placeholder="AD5X Nopoop .4" /></div>
      <div class="mh-actions">
        <button id="mh-wf-plan">План (dry-run)</button>
        <button id="mh-wf-run" class="primary">Нарезать и напечатать</button>
      </div>
      <div class="mh-muted">Печать начнётся сразу — убедись, что стол пуст.</div>
      <pre class="mh-pre" id="mh-wf-result"></pre>
    </div>
  </div>

  <div class="mh-page" id="page-logs">
    <div class="mh-grid">
      <div class="mh-card">
        <h3>Отчёты слайсинга</h3>
        <div class="mh-list" id="mh-reports-list"></div>
        <pre class="mh-pre" id="mh-report-detail"></pre>
      </div>
      <div class="mh-card">
        <h3>События OrcaSlicer</h3>
        <div class="mh-list" id="mh-events-list"></div>
      </div>
    </div>
  </div>

  <div class="mh-page" id="page-orca">
    <div class="mh-card">
      <h3>Установка OrcaSlicer</h3>
      <div class="mh-actions"><button id="mh-orca-info">Информация</button><button id="mh-orca-presets">Профили AD5X</button><button id="mh-orca-events">События моста</button></div>
      <pre class="mh-pre" id="mh-orca-result"></pre>
    </div>
    <div class="mh-grid">
      <div class="mh-card">
        <h3>Spoolman</h3>
        <div class="mh-row"><input type="text" id="mh-spoolman-url" placeholder="http://127.0.0.1:7912" /><button id="mh-spoolman-save">Сохранить</button><button id="mh-spoolman-load">Список</button></div>
        <pre class="mh-pre" id="mh-spoolman-result"></pre>
      </div>
      <div class="mh-card">
        <h3>Уведомления</h3>
        <div class="mh-row"><input type="text" id="mh-webhook-url" placeholder="https://api.telegram.org/bot.../sendMessage" /><button id="mh-webhook-save">Сохранить</button><button id="mh-webhook-test">Тест</button></div>
        <pre class="mh-pre" id="mh-webhook-result"></pre>
      </div>
    </div>
  </div>

  <div id="mh-settings-modal" style="display:none;position:fixed;inset:0;z-index:20;align-items:center;justify-content:center">
    <div style="position:absolute;inset:0;background:rgba(0,0,0,.55)" id="mh-settings-backdrop"></div>
    <div style="position:relative;width:min(560px,92vw);max-height:86vh;overflow:auto;border:1px solid var(--orca-border);border-radius:14px;padding:16px;background:var(--orca-bg);box-shadow:0 16px 50px rgba(0,0,0,.45)">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><strong style="font-size:15px">Настройки моста</strong><span style="flex:1"></span><button id="mh-settings-close">✕</button></div>
      <div class="mh-card" style="margin:0 0 10px">
        <h3>Подключение</h3>
        <div class="mh-row"><input type="text" id="set-host" placeholder="http://127.0.0.1:8765" /><input type="text" id="set-printer" placeholder="http://192.168.1.183:7125" /></div>
        <div class="mh-row"><input type="text" id="set-slicer" placeholder="C:\Program Files\OrcaSlicer\orca-slicer.exe" /></div>
      </div>
      <div class="mh-card" style="margin:0 0 10px">
        <h3>Интеграции</h3>
        <div class="mh-row"><input type="text" id="set-spoolman" placeholder="Spoolman URL" /></div>
        <div class="mh-row"><input type="text" id="set-webhook" placeholder="Webhook URL (Telegram)" /></div>
      </div>
      <div class="mh-card" style="margin:0 0 10px">
        <h3>Интерфейс</h3>
        <div class="mh-row"><label><input type="checkbox" id="set-auto" /> Автообновление</label><input type="number" id="set-interval" min="3" max="600" style="max-width:90px" /><select id="set-lang"><option value="ru">RU</option><option value="en">EN</option></select></div>
      </div>
      <div class="mh-actions" style="justify-content:flex-end"><button id="set-save" class="primary">Сохранить</button></div>
      <div class="mh-muted" id="set-status"></div>
    </div>
  </div>
</div>
<script>
(function () {
  const $ = (id) => document.getElementById(id);
  const send = (type, extra) => orca.postMessage(Object.assign({ type: type }, extra || {}));
  let previewReady = false;
  let timer = null;
  let temps = [];
  let cmdHistory = [];
  const I18N = {
    ru: { overview: "Обзор", printer: "Принтер", tools: "Инструменты", logs: "Логи", orca: "Orca", refresh: "Обновить" },
    en: { overview: "Overview", printer: "Printer", tools: "Tools", logs: "Logs", orca: "Orca", refresh: "Refresh" },
  };
  function applyLang(lang) {
    const d = I18N[lang] || I18N.ru;
    const map = { dash: d.overview, control: d.printer, tools: d.tools, logs: d.logs, orca: d.orca };
    for (const b of document.querySelectorAll("#mh-nav button")) if (map[b.dataset.tab]) b.textContent = map[b.dataset.tab];
    $("mh-refresh").textContent = d.refresh;
  }

  function toast(text, kind) {
    const box = $("mh-toast");
    const el = document.createElement("div");
    el.className = kind || "";
    el.textContent = text;
    box.appendChild(el);
    setTimeout(function () { el.remove(); }, 4200);
  }
  function kv(el, pairs) {
    el.innerHTML = "";
    for (const p of pairs) {
      const k = document.createElement("span"); k.textContent = p[0];
      const v = document.createElement("span"); v.textContent = p[1];
      el.appendChild(k); el.appendChild(v);
    }
  }
  function badge(el, text, kind) {
    const b = document.createElement("span");
    b.className = "mh-badge " + (kind || "");
    b.textContent = text;
    el.appendChild(b);
  }
  function drawChart() {
    const svg = $("mh-chart");
    if (!svg) return;
    if (!temps.length) { svg.innerHTML = '<text x="8" y="48" fill="var(--orca-muted)" font-size="11">нет данных</text>'; return; }
    const max = Math.max(260, ...temps.map(function (p) { return Math.max(p.n, p.b); })) + 10;
    const min = Math.min(20, ...temps.map(function (p) { return Math.min(p.n, p.b); })) - 10;
    function line(key, color) {
      const pts = temps.map(function (p, i) {
        const x = 4 + i * (312 / Math.max(1, temps.length - 1));
        const y = 86 - ((p[key] - min) / (max - min)) * 78;
        return x.toFixed(1) + "," + y.toFixed(1);
      });
      return '<polyline fill="none" stroke="' + color + '" stroke-width="2" points="' + pts.join(" ") + '"/>';
    }
    svg.innerHTML = line("n", "#e67e22") + line("b", "#3498db");
  }
  function renderAFC(data) {
    const box = $("mh-afc-lanes");
    if (!box) return;
    box.innerHTML = "";
    for (const l of data.lanes || []) {
      const card = document.createElement("div");
      card.className = "mh-card";
      card.style.margin = "0";
      const color = l.color && l.color !== "#FFFFFF" ? l.color : "#888";
      card.innerHTML = '<h3>' + (l.tool || ("L" + l.lane)) + '</h3>' +
        '<div><span class="mh-badge" style="border-color:' + color + '">&nbsp;&nbsp;&nbsp;</span> ' + (l.material || "?") + '</div>' +
        '<div class="mh-muted">' + (l.status || "") + ' · ' + (l.filamentStatus || "") + '</div>' +
        '<div class="mh-muted">остаток: ' + (l.weight != null ? l.weight + " г" : "—") + '</div>';
      box.appendChild(card);
    }
  }
  function renderHistory() {
    const box = $("mh-cmd-history");
    if (!box) return;
    box.innerHTML = "";
    if (!cmdHistory.length) { box.textContent = "Пока пусто"; return; }
    for (const cmd of cmdHistory.slice(-15).reverse()) {
      const row = document.createElement("div");
      row.textContent = cmd;
      row.onclick = function () { $("mh-cmd").value = cmd; send("command", { command: cmd, confirm: false }); };
      box.appendChild(row);
    }
  }

  function renderStatus(d) {
    const h = d.health || {};
    const t = h.totals || {};
    kv($("mh-health-kv"), [
      ["Состояние", h.ok ? "онлайн" : "офлайн"],
      ["Серверов", t.servers + " / " + t.enabled + " активны"],
      ["Инструментов", String(t.tools)],
    ]);
    $("mh-health-raw").textContent = JSON.stringify(h, null, 2);
    const p = d.printer || {};
    const pr = p.printer || {};
    const tempData = p.temperatures || {};
    kv($("mh-printer-kv"), [
      ["Статус", pr.state || p.status || "—"],
      ["Сопло", tempData.nozzle ? tempData.nozzle.actual + "°C" : "—"],
      ["Стол", tempData.bed ? tempData.bed.actual + "°C" : "—"],
      ["Хост", pr.hostname || ""],
    ]);
    const n = tempData.nozzle ? Number(tempData.nozzle.actual) : 0;
    const b = tempData.bed ? Number(tempData.bed.actual) : 0;
    if (n || b) {
      temps.push({ n: n, b: b });
      if (temps.length > 90) temps.shift();
      drawChart();
    }
    const ps = p.print || {};
    kv($("mh-print-stats"), [
      ["Состояние", ps.state || "—"],
      ["Файл", ps.filename || "—"],
      ["Время печати", Math.round((ps.print_duration || 0) / 60) + " мин"],
      ["Филамент", (ps.filament_used || 0).toFixed(1) + " мм"],
    ]);
    const badges = $("mh-printer-badges"); badges.innerHTML = "";
    if (p.protocol) badge(badges, p.protocol, "good");
    if (p.print && p.print.state) badge(badges, p.print.state, p.print.state === "printing" ? "warn" : "");
    if (p.error) badge(badges, p.error, "bad");
    $("mh-printer-raw").textContent = JSON.stringify(p, null, 2);

    $("mh-reports-list").innerHTML = "";
    for (const r of d.reports || []) {
      const row = document.createElement("div");
      row.textContent = r.name || r;
      row.onclick = function () { send("report", { name: r.name }); };
      const ex = document.createElement("button");
      ex.textContent = "↧";
      ex.style.float = "right";
      ex.title = "Экспорт в файл";
      ex.onclick = function (e) { e.stopPropagation(); send("export", { name: r.name }); };
      row.appendChild(ex);
      $("mh-reports-list").appendChild(row);
    }
    $("mh-events-list").innerHTML = "";
    for (const e of d.events || []) {
      const row = document.createElement("div");
      row.textContent = (e.event || "?") + " · " + (e.code || "") + " · " + (e.name || "");
      $("mh-events-list").appendChild(row);
    }
    const dot = $("mh-dot");
    dot.textContent = h.ok ? "● онлайн" : "● офлайн";
    dot.className = "mh-dot " + (h.ok ? "on" : "off");
    $("mh-time").textContent = d.ts || "";
    if (d.autoRefresh) {
      if (!timer) timer = setInterval(function () { send("refresh"); }, Math.max(3, d.refreshSeconds || 5) * 1000);
    } else if (timer) { clearInterval(timer); timer = null; }
  }

  function put(target, value) {
    const el = $(target);
    if (!el) return;
    el.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  }

  orca.onMessage(function (d) {
    if (!d) return;
    if (d.type === "status") { renderStatus(d); return; }
    if (d.type === "result") {
      put(d.target, d.result);
      if (d.preview) previewReady = true;
      if (d.toast) toast(d.toast, d.err ? "err" : "ok");
      return;
    }
    if (d.type === "toast") { toast(d.text, d.kind); return; }
    if (d.type === "lang") { applyLang(d.lang); return; }
    if (d.type === "afc") { renderAFC(d.data); return; }
    if (d.type === "settings") {
      if ($("mh-spoolman-url")) $("mh-spoolman-url").value = d.data.spoolman?.baseUrl || "";
      if ($("mh-webhook-url")) $("mh-webhook-url").value = d.data.hasWebhook ? "********" : "";
      if ($("set-host")) $("set-host").value = d.data.host || "http://127.0.0.1:8765";
      if ($("set-printer")) $("set-printer").value = d.data.printer?.baseUrl || "";
      if ($("set-slicer")) $("set-slicer").value = d.data.slicer?.command || "";
      if ($("set-spoolman")) $("set-spoolman").value = d.data.spoolman?.baseUrl || "";
      if ($("set-webhook")) $("set-webhook").value = d.data.hasWebhook ? "********" : "";
      if ($("set-auto")) $("set-auto").checked = d.data.autoRefresh !== false;
      if ($("set-interval")) $("set-interval").value = d.data.refreshSeconds || 5;
      if ($("set-lang")) $("set-lang").value = d.data.language || "ru";
      return;
    }
    if (d.type === "event") { toast("Событие: " + d.name, ""); }
  });
  send("ready");

  $("mh-nav").addEventListener("click", function (e) {
    const b = e.target.closest("button[data-tab]");
    if (!b) return;
    for (const x of $("mh-nav").querySelectorAll("button")) x.classList.remove("active");
    b.classList.add("active");
    for (const p of document.querySelectorAll(".mh-page")) p.classList.remove("active");
    $("page-" + b.dataset.tab).classList.add("active");
  });
  let armed = null;
  for (const b of $("mh-quick").querySelectorAll("button")) {
    b.onclick = function () {
      const a = b.dataset.a;
      if (a === "status" || a === "files") { send("printer_action", { action: a, confirm: false }); return; }
      if (armed === b) {
        armed = null;
        if (a === "gcode") send("command", { command: b.dataset.cmd, confirm: true });
        else if (a === "photo") send("printer_action", { action: "camera", confirm: true });
        else send("printer_action", { action: a, confirm: true });
        return;
      }
      armed = b;
      toast("Нажмите ещё раз для подтверждения");
      setTimeout(function () { if (armed === b) armed = null; }, 4000);
    };
  }
  $("mh-refresh").onclick = function () { send("refresh"); };
  $("mh-doctor").onclick = function () { send("doctor"); };
  $("mh-preview").onclick = function () { send("command", { command: $("mh-cmd").value, confirm: false }); };
  $("mh-send").onclick = function () {
    if (!previewReady) { put("mh-cmd-result", "Сначала нажми «Предпросмотр»."); return; }
    previewReady = false;
    send("command", { command: $("mh-cmd").value, confirm: true });
  };
  $("mh-model-check").onclick = function () { send("model", { path: $("mh-model-path").value, buildVolume: $("mh-model-volume").value }); };
  $("mh-gcode-check").onclick = function () { send("gcode", { path: $("mh-gcode-path").value }); };
  $("mh-profiles").onclick = function () { send("profiles", { kind: $("mh-profile-kind").value, query: $("mh-profile-query").value }); };
  $("mh-tools").onclick = function () { send("tools", { query: $("mh-tool-query").value }); };
  $("mh-probe").onclick = function () { send("probe", { subnet: $("mh-subnet").value }); };
  $("mh-orca-info").onclick = function () { send("orca_info"); };
  $("mh-orca-presets").onclick = function () { send("orca_presets"); };
  $("mh-orca-events").onclick = function () { send("orca_events"); };
  $("mh-afc-refresh").onclick = function () { send("afc"); };
  $("mh-wf-plan").onclick = function () {
    send("workflow", {
      input: $("mh-wf-input").value, outputDir: $("mh-wf-outdir").value,
      machineProfile: $("mh-wf-machine").value, processProfile: $("mh-wf-process").value,
      confirm: false,
    });
  };
  $("mh-wf-run").onclick = function () {
    send("workflow", {
      input: $("mh-wf-input").value, outputDir: $("mh-wf-outdir").value,
      machineProfile: $("mh-wf-machine").value, processProfile: $("mh-wf-process").value,
      confirm: true,
    });
  };
  $("mh-spoolman-load").onclick = function () { send("spoolman"); };
  $("mh-spoolman-save").onclick = function () { send("settings_save", { spoolman: { baseUrl: $("mh-spoolman-url").value } }); };
  $("mh-webhook-save").onclick = function () {
    const v = $("mh-webhook-url").value;
    send("settings_save", { notifications: { webhookUrl: v === "********" ? "" : v } });
  };
  $("mh-webhook-test").onclick = function () { send("notify_test", { text: "MCP Hub: тестовое уведомление" }); };

  function openSettings() {
    const m = $("mh-settings-modal");
    m.style.display = "flex";
    send("settings_get");
  }
  function closeSettings() { $("mh-settings-modal").style.display = "none"; }
  $("mh-settings-btn").onclick = openSettings;
  $("mh-settings-close").onclick = closeSettings;
  $("mh-settings-backdrop").onclick = closeSettings;
  $("set-save").onclick = function () {
    const wh = $("set-webhook").value;
    send("settings_save", {
      printer: { baseUrl: $("set-printer").value },
      slicer: { command: $("set-slicer").value },
      spoolman: { baseUrl: $("set-spoolman").value },
      notifications: { webhookUrl: wh === "********" ? "" : wh },
    });
    send("save_ui_config", { config: {
      host: $("set-host").value || "http://127.0.0.1:8765",
      refreshSeconds: Number($("set-interval").value) || 5,
      autoRefresh: $("set-auto").checked,
      language: $("set-lang").value,
      logLifecycleEvents: true,
    } });
    $("set-status").textContent = "Сохранено";
    setTimeout(closeSettings, 700);
  };
  send("settings_get");
})();
</script>
"""


class McpHubPage(orca.pages.PagesPluginCapabilityBase):
    def get_name(self):
        return "MCP Hub"

    def get_default_config(self):
        return {"host": DEFAULT_HOST, "refreshSeconds": 5, "autoRefresh": True, "logLifecycleEvents": True, "language": "ru"}

    def has_config_ui(self):
        return True

    def get_config_ui(self):
        return r"""
        <style>.mcfg label{display:block;margin:8px 0 4px}.mcfg input[type=text],.mcfg input[type=number]{width:100%}</style>
        <div class="mcfg">
          <label>Адрес моста</label><input type="text" id="cfg-host" />
          <label>Интервал обновления, сек (0 = выключить)</label><input type="number" id="cfg-interval" min="0" max="600" />
          <label>Язык интерфейса</label>
          <select id="cfg-lang"><option value="ru">Русский</option><option value="en">English</option></select>
          <label><input type="checkbox" id="cfg-events" /> Логировать события</label>
          <button id="cfg-save">Сохранить</button><span id="cfg-status"></span>
        </div>
        <script>
          (function () {
            var c = window.orca.getConfig() || {};
            document.getElementById('cfg-host').value = c.host || '""" + DEFAULT_HOST + r"""';
            document.getElementById('cfg-interval').value = c.refreshSeconds == null ? 5 : c.refreshSeconds;
            document.getElementById('cfg-events').checked = c.logLifecycleEvents !== false;
            document.getElementById('cfg-lang').value = c.language || 'ru';
            document.getElementById('cfg-save').onclick = function () {
              var n = Number(document.getElementById('cfg-interval').value) || 0;
              var ok = window.orca.saveConfig({
                host: document.getElementById('cfg-host').value.trim(),
                refreshSeconds: n || 5,
                autoRefresh: n > 0,
                logLifecycleEvents: document.getElementById('cfg-events').checked,
                language: document.getElementById('cfg-lang').value
              });
              document.getElementById('cfg-status').textContent = ok ? 'Сохранено' : 'Ошибка';
            };
          })();
        </script>
        """

    def get_ui(self):
        return PAGE

    def _post_status(self, health, printer, reports, events):
        cfg = _cfg(self)
        self.post_message({
            "type": "status",
            "health": health,
            "printer": printer,
            "reports": reports.get("reports", []) if isinstance(reports, dict) else [],
            "events": events.get("events", []) if isinstance(events, dict) else [],
            "autoRefresh": bool(cfg.get("autoRefresh", True)),
            "refreshSeconds": cfg.get("refreshSeconds", 5),
            "ts": "обновлено",
        })

    def _refresh(self):
        results = {}

        def collect(key):
            def done(ok, data):
                results[key] = (ok, data)
                if len(results) == 4:
                    self._post_status(
                        results["health"][1], results["printer"][1],
                        results["reports"][1], results["events"][1],
                    )
            return done

        _api_async(self, collect("health"), "GET", "/health", timeout=2.0)
        _api_async(self, collect("printer"), "GET", "/printer/status", timeout=2.0)
        _api_async(self, collect("reports"), "POST", "/reports/list", {"limit": 8}, timeout=2.0)
        _api_async(self, collect("events"), "POST", "/plugin/events/list", {"limit": 20}, timeout=2.0)

    def on_message(self, data):
        kind = data.get("type")

        def reply(target, toast=None):
            def done(ok, result):
                self.post_message({
                    "type": "result", "target": target,
                    "result": result if ok else {"error": result.get("error")},
                    "toast": toast, "err": not ok,
                })
            return done

        if kind in ("ready", "refresh"):
            if kind == "ready":
                self.post_message({"type": "lang", "lang": _cfg(self).get("language", "ru")})
            self._refresh()
        elif kind == "doctor":
            _api_async(self, reply("mh-health-raw", "Диагностика выполнена"), "GET", "/diagnostics", timeout=30.0)
        elif kind == "command":
            command = str(data.get("command") or "").strip()
            if not command:
                self.post_message({"type": "toast", "text": "Пустая команда", "kind": "err"})
                return
            confirmed = data.get("confirm") is True
            def cmd_done(ok, result):
                self.post_message({
                    "type": "result", "target": "mh-cmd-result",
                    "result": result if ok else {"error": result.get("error")},
                    "preview": not confirmed,
                })
                self.post_message({
                    "type": "toast",
                    "text": "Команда отправлена" if confirmed else "Предпросмотр готов",
                    "kind": "" if ok else "err",
                })
            _api_async(self, cmd_done, "POST", "/printer/command", {
                "command": command, "confirm": confirmed,
            }, timeout=10.0)
        elif kind == "printer_action":
            action = str(data.get("action") or "status")
            _api_async(self, reply("mh-printer-raw", action), "POST", "/printer/action", {
                "action": action, "confirm": data.get("confirm") is True,
            }, timeout=10.0)
        elif kind == "model":
            path = str(data.get("path") or "").strip()
            if not path:
                self.post_message({"type": "toast", "text": "Укажи путь к модели", "kind": "err"})
                return
            _api_async(self, reply("mh-model-result", "Модель проверена"), "POST", "/model/inspect", {
                "path": path, "buildVolume": str(data.get("buildVolume") or "").strip() or None,
            }, timeout=15.0)
        elif kind == "gcode":
            path = str(data.get("path") or "").strip()
            if not path:
                self.post_message({"type": "toast", "text": "Укажи путь к G-code", "kind": "err"})
                return
            _api_async(self, reply("mh-gcode-result", "G-code проанализирован"), "POST", "/gcode/analyze", {"path": path}, timeout=15.0)
        elif kind == "profiles":
            _api_async(self, reply("mh-profiles-result"), "POST", "/profiles/search", {
                   "kind": str(data.get("kind") or "all"),
                   "query": str(data.get("query") or ""), "limit": 60,
               }, timeout=8.0)
        elif kind == "tools":
            _api_async(self, reply("mh-tools-result"), "POST", "/hub/tools/search", {
                   "query": str(data.get("query") or ""), "limit": 60,
               }, timeout=15.0)
        elif kind == "probe":
            subnet = str(data.get("subnet") or "").strip()
            _api_async(self, reply("mh-probe-result", "Сканирование завершено"), "POST", "/printer/probe", {
                "subnet": subnet or None, "limit": 60, "timeoutMs": 400,
            }, timeout=40.0)
        elif kind == "report":
            name = str(data.get("name") or "").strip()
            if name:
                _api_async(self, reply("mh-report-detail"), "POST", "/reports/get", {
                    "name": name,
                }, timeout=8.0)
        elif kind == "orca_info":
            _api_async(self, reply("mh-orca-result"), "GET", "/orca/info", timeout=8.0)
        elif kind == "orca_presets":
            _api_async(self, reply("mh-orca-result"), "POST", "/orca/presets/search", {
                "source": "orca", "kind": "process", "query": "AD5X", "limit": 20,
            }, timeout=8.0)
        elif kind == "orca_events":
            _api_async(self, reply("mh-orca-result"), "POST", "/orca/events/list", {"limit": 30}, timeout=8.0)
        elif kind == "afc":
            def afc_done(ok, result):
                self.post_message({"type": "afc", "data": result if ok else {"lanes": [], "error": result.get("error")}})
                if not ok:
                    self.post_message({"type": "toast", "text": "AFC недоступен", "kind": "err"})
            _api_async(self, afc_done, "GET", "/printer/afc", timeout=8.0)
        elif kind == "workflow":
            payload = {
                "input": str(data.get("input") or "").strip(),
                "outputDir": str(data.get("outputDir") or "").strip() or None,
                "machineProfile": str(data.get("machineProfile") or "").strip() or None,
                "processProfile": str(data.get("processProfile") or "").strip() or None,
                "confirm": data.get("confirm") is True,
            }
            if not payload["input"]:
                self.post_message({"type": "toast", "text": "Укажи путь к модели", "kind": "err"})
                return
            _api_async(self, reply("mh-wf-result", "Цикл завершён"), "POST", "/workflow/slice_print", payload, timeout=300.0)
        elif kind == "spoolman":
            _api_async(self, reply("mh-spoolman-result"), "GET", "/spoolman/spools", timeout=8.0)
        elif kind == "settings_get":
            def settings_done(ok, result):
                data = dict(result) if ok else {}
                cfg = _cfg(self)
                data.update({
                    "host": cfg.get("host", DEFAULT_HOST),
                    "autoRefresh": cfg.get("autoRefresh", True),
                    "refreshSeconds": cfg.get("refreshSeconds", 5),
                    "language": cfg.get("language", "ru"),
                })
                self.post_message({"type": "settings", "data": data})
            _api_async(self, settings_done, "GET", "/settings", timeout=5.0)
        elif kind == "save_ui_config":
            try:
                ok = self.save_config(json.dumps(data.get("config", {})))
            except Exception:
                ok = False
            self.post_message({"type": "toast", "text": "Настройки интерфейса сохранены" if ok else "Ошибка сохранения", "kind": "" if ok else "err"})
            if ok:
                self.on_message({"type": "settings_get"})
        elif kind == "settings_save":
            payload = {k: v for k, v in data.items() if k in ("spoolman", "notifications", "printer", "slicer")}
            def saved(ok, result):
                self.post_message({"type": "toast", "text": "Настройки сохранены" if ok else "Ошибка сохранения", "kind": "" if ok else "err"})
                if ok:
                    self.on_message({"type": "settings_get"})
            _api_async(self, saved, "POST", "/settings", payload, timeout=8.0)
        elif kind == "notify_test":
            _api_async(self, reply("mh-webhook-result", "Уведомление отправлено"), "POST", "/notify/send", {
                "text": str(data.get("text") or "MCP Hub"), "event": "test",
            }, timeout=10.0)
        elif kind == "export":
            def export_done(ok, result):
                if ok and result.get("exportedTo"):
                    self.post_message({"type": "toast", "text": "Экспорт: " + result["exportedTo"]})
                else:
                    self.post_message({"type": "toast", "text": "Ошибка экспорта", "kind": "err"})
            _api_async(self, export_done, "POST", "/reports/export", {
                "name": str(data.get("name") or ""),
            }, timeout=8.0)

    def on_lifecycle_event(self, event, ctx):
        name = _event_name(event)
        code = str(getattr(ctx, "code", ""))
        subject = str(getattr(ctx, "name", "") or "")
        try:
            self.post_message({"type": "event", "name": name, "code": code, "subject": subject})
        except Exception:
            pass
        if _cfg(self).get("logLifecycleEvents", True):
            _api_async(self, lambda ok, data: None, "POST", "/plugin/event", {
                "event": name, "code": code, "name": subject,
                "msg": str(getattr(ctx, "msg", "") or ""),
                "device_id": str(getattr(ctx, "device_id", "") or ""),
                "source": str(getattr(ctx, "source", "") or ""),
                "plugin": "mcp-hub-bridge",
            }, timeout=2.0)
        if name in ("GCodeExportFinished", "SlicingJobComplete", "ProjectOpened"):
            self._refresh()


class McpHubSliceReport(orca.slicing.SlicingPipelineCapabilityBase):
    def get_name(self):
        return "Analyze in MCP Hub"

    def get_default_config(self):
        return {"host": DEFAULT_HOST, "enabled": True, "includeModel": True}

    def has_config_ui(self):
        return True

    def get_config_ui(self):
        return r"""
        <div style="font-size:13px">
          <label>Адрес моста</label><br/><input type="text" id="s-host" style="width:100%" />
          <label><input type="checkbox" id="s-enabled" /> Анализировать после нарезки</label>
          <label><input type="checkbox" id="s-model" /> Передавать статистику модели</label>
          <button id="s-save">Сохранить</button><span id="s-status"></span>
        </div>
        <script>
          (function () {
            var c = window.orca.getConfig() || {};
            document.getElementById('s-host').value = c.host || '""" + DEFAULT_HOST + r"""';
            document.getElementById('s-enabled').checked = c.enabled !== false;
            document.getElementById('s-model').checked = c.includeModel !== false;
            document.getElementById('s-save').onclick = function () {
              var ok = window.orca.saveConfig({
                host: document.getElementById('s-host').value.trim(),
                enabled: document.getElementById('s-enabled').checked,
                includeModel: document.getElementById('s-model').checked
              });
              document.getElementById('s-status').textContent = ok ? 'Сохранено' : 'Ошибка';
            };
          })();
        </script>
        """

    def execute(self, ctx):
        if ctx.step != orca.slicing.Step.psGCodePostProcess:
            return orca.ExecutionResult.skipped()
        cfg = _cfg(self, {"includeModel": True})
        if not cfg.get("enabled", True):
            return orca.ExecutionResult.skipped("MCP Hub report disabled")
        if ctx.cancelled():
            return orca.ExecutionResult.skipped("print cancelled")
        payload = {"gcodePath": ctx.gcode_path, "outputName": ctx.output_name, "orcaVersion": ctx.orca_version}
        if cfg.get("includeModel", True):
            payload["model"] = _model_summary()
        try:
            payload["config"] = {
                "printerModel": ctx.config_value("printer_model"),
                "layerHeight": ctx.config_value("layer_height"),
                "nozzleDiameter": ctx.config_value("nozzle_diameter"),
            }
        except Exception:
            payload["config"] = {}
        ok, result = _api(self, "POST", "/slice/done", payload, timeout=20.0)
        if not ok:
            return orca.ExecutionResult.failure(
                orca.PluginResult.RecoverableError,
                "MCP Hub недоступен: " + str(result.get("error")),
            )
        summary = result.get("summary") or {}
        message = "MCP Hub: {} слоёв, {}".format(summary.get("layers"), summary.get("estimatedTime") or "—")
        if summary.get("warnings"):
            message += "; предупреждений: " + str(len(summary["warnings"]))
        return orca.ExecutionResult.success(message, json.dumps(result))


SCRIPT_HTML = r"""
<style>.mh-s label{display:block;margin:10px 0 4px}.mh-s select,.mh-s button{min-width:240px;padding:6px}</style>
<div class="mh-s">
  <h3>MCP Hub</h3>
  <label>Действие</label>
  <select id="mh-action">
    <option value="health">Статус моста</option>
    <option value="printer">Статус принтера</option>
    <option value="profiles">Профили AD5X</option>
    <option value="howto">Как включить автоанализ</option>
  </select>
  <label>&nbsp;</label>
  <button onclick="orca.submit({action: document.getElementById('mh-action').value})">Выполнить</button>
</div>
"""


class McpHubScript(orca.script.ScriptPluginCapabilityBase):
    def get_name(self):
        return "Sync with MCP Hub"

    def execute(self):
        try:
            choice = orca.host.ui.show_dialog(SCRIPT_HTML, title="MCP Hub", width=420, height=280)
        except Exception:
            choice = {"action": "health"}
        action = (choice or {}).get("action", "health")
        if action == "howto":
            return orca.ExecutionResult.success(
                "File > Plugins > MCP Hub Bridge → Activate; в пресете Advanced добавить "
                "'Analyze in MCP Hub' в slicing_pipeline_plugin. Адрес: http://127.0.0.1:8765"
            )
        if action == "printer":
            ok, result = _api(self, "GET", "/printer/status", timeout=2.0)
        elif action == "profiles":
            ok, result = _api(self, "POST", "/profiles/search", {
                "kind": "machine", "query": "AD5X", "limit": 10,
            }, timeout=2.0)
        else:
            ok, result = _api(self, "GET", "/health", timeout=2.0)
        if not ok:
            return orca.ExecutionResult.failure(
                orca.PluginResult.RecoverableError,
                "MCP Hub недоступен: " + str(result.get("error")),
            )
        return orca.ExecutionResult.success("MCP Hub [{}]: {}".format(action, json.dumps(result)[:400]))


@orca.plugin
class McpHubPlugin(orca.base):
    def register_capabilities(self):
        orca.request_permissions(network_http=PERMISSION_URLS, threading=True)
        orca.register_capability(McpHubPage)
        orca.register_capability(McpHubSliceReport)
        orca.register_capability(McpHubScript)
