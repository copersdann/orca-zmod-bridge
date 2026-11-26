// Parametric bracket for one spool load cell (ESP32 spool scale project).
// Render: openscad spool_scale_bracket.scad -o bracket.stl

arm_length   = 90;    // mm, from frame to axle center
arm_width    = 22;
arm_thick    = 6;

cell_l       = 80;    // load cell body length
cell_w       = 12.7;  // load cell body width
cell_t       = 6;     // load cell thickness
cell_hole    = 3.2;   // mounting holes
cell_inset   = 6;     // distance from cell end to hole

axle_d       = 8;     // 608ZZ inner diameter
hub_outer    = 22;    // 608ZZ outer diameter
hub_height   = 14;

m3           = 3.0;
clearance    = 0.3;
frame_thick  = 8;

$fn = 48;

module bracket() {
  difference() {
    union() {
      // baseline beam
      translate([0, -arm_width/2, 0])
        cube([arm_length, arm_width, arm_thick]);

      // upright at the frame side (bolts to printer frame)
      translate([0, -arm_width/2, 0])
        cube([frame_thick, arm_width, 26]);

      // axle boss at the free end
      translate([arm_length, 0, arm_thick])
        cylinder(h = hub_height, d = hub_outer, center = true);
    }

    // axle hole (608 press fit zone)
    translate([arm_length, 0, arm_thick])
      cylinder(h = hub_height + 2, d = axle_d + 0.05, center = true);

    // M3 holes in the upright
    for (z = [8, 20]) {
      translate([frame_thick/2, 0, z])
        rotate([0, 90, 0])
          cylinder(h = frame_thick + 2, d = m3, center = true);
    }

    // load cell pocket on top of the beam
    translate([cell_inset, -cell_w/2 - clearance/2, arm_thick - cell_t - 1])
      cube([cell_l, cell_w + clearance, cell_t + 2]);

    // load cell mounting holes (through the pocket floor)
    for (x = [cell_inset + 5, cell_inset + cell_l - 5]) {
      translate([x, 0, arm_thick - cell_t - 2])
        cylinder(h = cell_t + 4, d = cell_hole, center = true);
    }

    // lightening slots
    translate([30, -6, 0]) cube([34, 12, arm_thick + 2]);
  }
}

module spool_hub() {
  difference() {
    cylinder(h = hub_height, d = hub_outer + 6);
    cylinder(h = hub_height + 2, d = axle_d + 0.1);
    // lightening holes
    for (i = [0:4]) {
      rotate([0, 0, i * 72])
        translate([8, 0, 0])
          cylinder(h = hub_height + 2, d = 6);
    }
  }
}

bracket();
translate([0, 45, 0]) spool_hub();
