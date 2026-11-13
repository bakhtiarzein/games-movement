/** Data lapangan. Satuan meter; tee di (0,0), lubang ke arah -z, +x = kanan pemain. */
export interface Circle { x: number; z: number; r: number }
export interface Ellipse { x: number; z: number; rx: number; rz: number }
export interface Hole {
  name: string;
  par: number;
  tee: { x: number; z: number };
  pin: { x: number; z: number };
  /** garis tengah fairway (polyline) dan lebarnya */
  fairway: { pts: { x: number; z: number }[]; width: number };
  green: Circle;
  bunkers: Circle[];
  water: Ellipse[];
  trees: Circle[];
  /** angin menyamping (m/s), + = ke kanan */
  wind: number;
}

const treeLine = (xs: number[], z0: number, z1: number, step: number): Circle[] => {
  const out: Circle[] = [];
  for (let z = z0; z >= z1; z -= step) for (const x of xs) out.push({ x: x + Math.sin(z * 0.37) * 4, z: z + Math.cos(x * 0.21) * 3, r: 2.4 + ((Math.abs(Math.sin(z + x)) * 1.6)) });
  return out;
};

export const HOLES: Hole[] = [
  {
    name: 'Taman Pembuka', par: 3, tee: { x: 0, z: 0 }, pin: { x: 4, z: -128 },
    fairway: { pts: [{ x: 0, z: 0 }, { x: 2, z: -110 }], width: 28 },
    green: { x: 4, z: -128, r: 15 },
    bunkers: [{ x: -14, z: -122, r: 7 }, { x: 19, z: -138, r: 6 }],
    water: [], trees: treeLine([-42, 42], 20, -150, 24), wind: 2,
  },
  {
    name: 'Tikungan Kanan', par: 4, tee: { x: 0, z: 0 }, pin: { x: 40, z: -270 },
    fairway: { pts: [{ x: 0, z: 0 }, { x: 4, z: -150 }, { x: 40, z: -262 }], width: 34 },
    green: { x: 40, z: -270, r: 15 },
    bunkers: [{ x: 26, z: -262, r: 7 }, { x: 56, z: -276, r: 6.5 }],
    water: [{ x: -24, z: -205, rx: 16, rz: 28 }],
    trees: [...treeLine([-46, 46], 20, -170, 26), ...treeLine([8, 78], -190, -290, 24)], wind: -3,
  },
  {
    name: 'Seberang Danau', par: 4, tee: { x: 0, z: 0 }, pin: { x: -8, z: -310 },
    fairway: { pts: [{ x: 0, z: 0 }, { x: -6, z: -250 }, { x: -8, z: -300 }], width: 38 },
    green: { x: -8, z: -310, r: 15 },
    bunkers: [{ x: -26, z: -306, r: 7 }, { x: 10, z: -318, r: 6 }, { x: -10, z: -285, r: 5 }],
    water: [{ x: -8, z: -278, rx: 30, rz: 9 }],
    trees: treeLine([-50, 50], 20, -330, 26), wind: 4,
  },
];

export const holeBounds = (h: Hole) => {
  let xmin = -60, xmax = 60, zmin = -h.pin.z * 0 + h.pin.z - 45, zmax = 28;
  for (const p of h.fairway.pts) { xmin = Math.min(xmin, p.x - 60); xmax = Math.max(xmax, p.x + 60); }
  return { xmin, xmax, zmin, zmax };
};
