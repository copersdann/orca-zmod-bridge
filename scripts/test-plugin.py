"""Локальный тест плагина OrcaSlicer против запущенного HTTP-моста."""
import importlib.util
import pathlib
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "plugins" / "orca" / "test_stub"))
import orca  # noqa: E402

spec = importlib.util.spec_from_file_location(
    "mcp_hub_bridge", ROOT / "plugins" / "orca" / "mcp_hub_bridge.py"
)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

GCODE = ROOT / "test-output2" / "plate_1.gcode"

# --- Pages ---
page = mod.McpHubPage()
messages = []
page.post_message = lambda data: messages.append(data)
print("PAGE tab:", page.get_name())
print("PAGE ui length:", len(page.get_ui()))
print("PAGE config ui length:", len(page.get_config_ui()))
page.on_message({"type": "ready"})
deadline = time.time() + 10
while time.time() < deadline and not any(m.get("type") == "status" for m in messages):
    time.sleep(0.1)
status = [m for m in messages if m.get("type") == "status"]
print("PAGE status received:", bool(status))
if status:
    print("  health.ok:", status[-1]["health"].get("ok"))
    print("  printer:", status[-1]["printer"].get("status"))
    print("  reports:", len(status[-1]["reports"]), "events:", len(status[-1]["events"]))

# --- Script ---
script = mod.McpHubScript()
result = script.execute()
print("SCRIPT:", result.status, result.message[:160])

# --- Slicing pipeline ---
class Ctx:
    step = orca.slicing.Step.psGCodePostProcess
    gcode_path = str(GCODE)
    output_name = "plate_1.gcode"
    orca_version = "2.5.2-test"

    def cancelled(self):
        return False

    def config_value(self, key):
        return {"printer_model": "Flashforge AD5X", "layer_height": 0.2, "nozzle_diameter": 0.4}.get(key)

slicecap = mod.McpHubSliceReport()
result = slicecap.execute(Ctx())
print("SLICE:", result.status, result.message[:200])

# --- Lifecycle event ---
page.on_lifecycle_event(
    orca.LifecycleEvent.GCodeExportFinished,
    orca.LifecycleEventContext(name=str(GCODE), msg="test export"),
)
time.sleep(1.0)
print("LIFECYCLE messages:", [m.get("type") for m in messages][-5:])
print("DONE")
