import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import trimesh
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output")
fig = plt.figure(figsize=(11, 9))
views = [("Isometric", 30, 45), ("Top", 90, -90), ("Front", 0, -90), ("Side", 0, 0)]
for idx, (title, elev, azim) in enumerate(views, 1):
    ax = fig.add_subplot(2, 2, idx, projection="3d")
    mesh = trimesh.load(os.path.join(OUT, "bracket.stl"))
    ax.plot_trisurf(mesh.vertices[:, 0], mesh.vertices[:, 1], mesh.vertices[:, 2],
                    triangles=mesh.faces, alpha=0.9, edgecolor="none", color="#3a8fbf")
    ax.view_init(elev=elev, azim=azim)
    ax.set_title(title)
    ax.set_box_aspect(mesh.extents)
plt.tight_layout()
plt.savefig(os.path.join(OUT, "preview.png"), dpi=160)
print("preview.png saved")
