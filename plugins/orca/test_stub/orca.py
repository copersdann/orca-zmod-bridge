"""Minimal stub of the embedded OrcaSlicer `orca` module for local plugin tests."""
import json
import os
import sys
import types


class PluginResult:
    Success = "Success"
    Skipped = "Skipped"
    RecoverableError = "RecoverableError"
    FatalError = "FatalError"


class ExecutionResult:
    def __init__(self, status, message="", data=""):
        self.status = status
        self.message = message
        self.data = data

    @staticmethod
    def success(message="", data=""):
        return ExecutionResult(PluginResult.Success, message, data)

    @staticmethod
    def skipped(message=""):
        return ExecutionResult(PluginResult.Skipped, message)

    @staticmethod
    def failure(status, message, data=""):
        return ExecutionResult(status, message, data)


class LifecycleEvtCode:
    Ok = "Ok"
    Error = "Error"
    Warn = "Warn"


class LifecycleEvent:
    GCodeExportFinished = "GCodeExportFinished"
    SlicingJobComplete = "SlicingJobComplete"
    ProjectOpened = "ProjectOpened"


class LifecycleEventContext:
    def __init__(self, **kwargs):
        self.name = kwargs.get("name", "")
        self.code = kwargs.get("code", LifecycleEvtCode.Ok)
        self.msg = kwargs.get("msg", "")
        self.device_id = kwargs.get("device_id", "")
        self.source = kwargs.get("source", "")


class base:
    def __init__(self):
        self.capabilities = []


def plugin(cls):
    return cls


def register_capability(cls):
    pass


def request_permissions(**kwargs):
    pass


class PythonPluginBase:
    def get_name(self):
        return "stub"

    def get_config(self):
        return json.dumps({"host": os.environ.get("MCP_HUB_TEST_HOST", "http://127.0.0.1:8765")})

    def post_message(self, data):
        pass

    def on_lifecycle_event(self, event, ctx):
        pass


# Submodules ---------------------------------------------------------------
script = types.ModuleType("orca.script")

class ScriptPluginCapabilityBase(PythonPluginBase):
    def execute(self):
        return ExecutionResult.success()

script.ScriptPluginCapabilityBase = ScriptPluginCapabilityBase

pages = types.ModuleType("orca.pages")

class PagesPluginCapabilityBase(PythonPluginBase):
    def get_ui(self):
        return ""

    def on_message(self, data):
        pass

pages.PagesPluginCapabilityBase = PagesPluginCapabilityBase

slicing = types.ModuleType("orca.slicing")

class Step:
    psGCodePostProcess = "psGCodePostProcess"
    posSlice = "posSlice"

class SlicingPipelineContext:
    pass

class SlicingPipelineCapabilityBase(PythonPluginBase):
    def execute(self, ctx):
        return ExecutionResult.success()

slicing.Step = Step
slicing.SlicingPipelineContext = SlicingPipelineContext
slicing.SlicingPipelineCapabilityBase = SlicingPipelineCapabilityBase

host = types.ModuleType("orca.host")
host_ui = types.ModuleType("orca.host.ui")

class _Vertex:
    pass

class _Mesh:
    def triangle_count(self):
        return 12

    def volume(self):
        return 1000.0

    def is_manifold(self):
        return True

class _Volume:
    name = "cube"

    def mesh(self):
        return _Mesh()

class _Object:
    def volumes(self):
        return [_Volume()]

class _Model:
    def objects(self):
        return [_Object()]

host.model = lambda: _Model()
host.plater = lambda: None
host.preset_bundle = lambda: None
host_ui.show_dialog = lambda html, title=None, width=None, height=None: {"action": "health"}
host_ui.message = lambda *a, **k: "ok"
host_ui.push_notification = lambda *a, **k: None
host.ui = host_ui

sys.modules["orca.script"] = script
sys.modules["orca.pages"] = pages
sys.modules["orca.slicing"] = slicing
sys.modules["orca.host"] = host
sys.modules["orca.host.ui"] = host_ui

script.ScriptPluginCapabilityBase = ScriptPluginCapabilityBase
pages.PagesPluginCapabilityBase = PagesPluginCapabilityBase
slicing.SlicingPipelineCapabilityBase = SlicingPipelineCapabilityBase

# Expose submodules and symbols as attributes, like the real embedded module.
script_module = sys.modules[__name__]
script_module.script = script
script_module.pages = pages
script_module.slicing = slicing
script_module.host = host
script_module.LifecycleEvent = LifecycleEvent
script_module.LifecycleEvtCode = LifecycleEvtCode
script_module.ExecutionResult = ExecutionResult
script_module.PluginResult = PluginResult
