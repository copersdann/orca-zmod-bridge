"""FreeCAD generator: spool weighing node for AD5X / ESP32 spool scale.

Parts (all mm):
  - bracket: cantilever arm for one load cell + upright + 608 bearing boss
  - axle: 8 mm axle with shoulder
  - hub: 608-based hub sleeve
  - spool_adapter: ring matching the spool core bore

Run: "C:\Program Files\FreeCAD 1.1\bin\freecadcmd.exe" model.py
"""
import os
import FreeCAD as App
import Part
import MeshPart

# ---------------- Parameters (mm) ----------------
ARM_LENGTH = 90.0
ARM_WIDTH = 22.0
ARM_THICK = 6.0

CELL_L = 80.0
CELL_W = 12.7
CELL_T = 6.0
CELL_HOLE_D = 3.2
CELL_INSET = 6.0

FRAME_T = 8.0
UPRIGHT_H = 26.0
M3_D = 3.0
CLEAR = 0.3
EPS = 0.05

AXLE_D = 8.0
AXLE_LEN = 40.0
AXLE_SHOULDER_D = 12.0
AXLE_SHOULDER_H = 3.0

BEARING_OD = 22.0
BEARING_H = 7.0
BOSS_OD = 34.0
BOSS_H = 14.0

HUB_OD = 30.0
HUB_H = 16.0
HUB_LIGHT_D = 6.0

SPOOL_CORE_D = 55.0   # подставь factual bore своей катушки
SPOOL_ADAPTER_H = 14.0

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output")
os.makedirs(OUT_DIR, exist_ok=True)

doc = App.newDocument("SpoolScaleNode")


def validate(name, shape):
    assert shape.isValid(), f"{name}: invalid BRep"
    assert shape.Volume > 0, f"{name}: zero volume"
    assert len(shape.Solids) == 1, f"{name}: expected 1 solid, got {len(shape.Solids)}"
    bb = shape.BoundBox
    print(f"OK {name}: V={shape.Volume:.1f} mm3 | {bb.XLength:.1f}x{bb.YLength:.1f}x{bb.ZLength:.1f} mm")
    return shape


def export(name, shape):
    validate(name, shape)
    obj = doc.addObject("Part::Feature", name)
    obj.Shape = shape
    doc.recompute()
    shape.exportStep(os.path.join(OUT_DIR, name + ".step"))
    mesh = MeshPart.meshFromShape(Shape=shape, LinearDeflection=0.05, AngularDeflection=0.5, Relative=False)
    mesh.write(os.path.join(OUT_DIR, name + ".stl"))


# ---------------- bracket ----------------
beam = Part.makeBox(ARM_LENGTH, ARM_WIDTH, ARM_THICK, App.Vector(0, -ARM_WIDTH / 2, 0))
upright = Part.makeBox(FRAME_T, ARM_WIDTH, UPRIGHT_H, App.Vector(0, -ARM_WIDTH / 2, 0))
boss = Part.makeCylinder(BOSS_OD / 2, BOSS_H, App.Vector(ARM_LENGTH, 0, ARM_THICK))
bracket = beam.fuse(upright).fuse(boss)

# bearing seat
seat = Part.makeCylinder((BEARING_OD + 0.1) / 2, BOSS_H + 2 * EPS,
                         App.Vector(ARM_LENGTH, 0, ARM_THICK - EPS))
bracket = bracket.cut(seat)

# M3 holes in upright
for z in (8.0, 20.0):
    hole = Part.makeCylinder(M3_D / 2, FRAME_T + 2 * EPS,
                             App.Vector(-EPS, 0, z), App.Vector(1, 0, 0))
    bracket = bracket.cut(hole)

# load cell pocket on top of the beam
pocket = Part.makeBox(CELL_L, CELL_W + CLEAR, CELL_T + 2,
                      App.Vector(CELL_INSET, -(CELL_W + CLEAR) / 2, ARM_THICK - CELL_T - 1))
bracket = bracket.cut(pocket)
for x in (CELL_INSET + 5.0, CELL_INSET + CELL_L - 5.0):
    h = Part.makeCylinder(CELL_HOLE_D / 2, CELL_T + 4 + 2 * EPS,
                          App.Vector(x, 0, ARM_THICK - CELL_T - 2 - EPS))
    bracket = bracket.cut(h)

# lightening slot
slot = Part.makeBox(34.0, 12.0, ARM_THICK + 2 * EPS,
                    App.Vector(30.0, -6.0, -EPS))
bracket = bracket.cut(slot)

export("bracket", bracket)

# ---------------- axle ----------------
axle = Part.makeCylinder(AXLE_D / 2, AXLE_LEN, App.Vector(0, 0, 0))
shoulder = Part.makeCylinder(AXLE_SHOULDER_D / 2, AXLE_SHOULDER_H,
                             App.Vector(0, 0, AXLE_LEN))
axle = axle.fuse(shoulder)
export("axle", axle)

# ---------------- hub ----------------
hub = Part.makeCylinder(HUB_OD / 2, HUB_H)
hub = hub.cut(Part.makeCylinder((AXLE_D + 0.1) / 2, HUB_H + 2 * EPS, App.Vector(0, 0, -EPS)))
for i in range(6):
    import math
    a = math.radians(i * 60)
    c = Part.makeCylinder(HUB_LIGHT_D / 2, HUB_H + 2 * EPS,
                          App.Vector(10.0 * math.cos(a), 10.0 * math.sin(a), -EPS))
    hub = hub.cut(c)
export("hub", hub)

# ---------------- spool adapter ----------------
adapter = Part.makeCylinder(SPOOL_CORE_D / 2, SPOOL_ADAPTER_H)
adapter = adapter.cut(Part.makeCylinder((HUB_OD + 0.1) / 2, SPOOL_ADAPTER_H + 2 * EPS,
                                        App.Vector(0, 0, -EPS)))
for i in range(6):
    import math
    a = math.radians(i * 60)
    c = Part.makeCylinder(4.0, SPOOL_ADAPTER_H + 2 * EPS,
                          App.Vector(20.0 * math.cos(a), 20.0 * math.sin(a), -EPS))
    adapter = adapter.cut(c)
export("spool_adapter", adapter)

doc.saveAs(os.path.join(OUT_DIR, "SpoolScaleNode.FCStd"))
print("DONE:", OUT_DIR)
