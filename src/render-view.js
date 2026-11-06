// Observe connected runs from their shared front side. Opposing runs have no
// shared front side, so use the first run with an oblique view down the aisle.
export function automatedViewDirection(rotations) {
  const normals = new Map();
  for (const yaw of rotations) {
    const x = Math.round(-Math.sin(yaw));
    const y = Math.round(Math.cos(yaw));
    normals.set(`${x},${y}`, [x, y]);
  }
  const fronts = [...normals.values()];
  if (!fronts.length) return [1, 1, 0.78];
  let x = fronts.reduce((sum, normal) => sum + normal[0], 0);
  let y = fronts.reduce((sum, normal) => sum + normal[1], 0);
  if (fronts.length === 1 || Math.hypot(x, y) < 0.01) {
    const [nx, ny] = fronts[0];
    x = nx + 0.65 * ny;
    y = ny - 0.65 * nx;
  }
  const length = Math.hypot(x, y);
  return [x / length, y / length, 0.78];
}
