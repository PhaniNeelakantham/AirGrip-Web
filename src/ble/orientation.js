// Quaternion <-> pitch/roll/yaw (same axis mapping as Prototype.py)
const DEG = 180 / Math.PI;

export function toAngles({ qw, qx, qy, qz }) {
  const pitch = Math.atan2(2 * (qw * qx + qy * qz), 1 - 2 * (qx * qx + qy * qy)) * DEG;
  const roll = Math.asin(Math.max(-1, Math.min(1, 2 * (qw * qy - qz * qx)))) * DEG;
  const yaw = Math.atan2(2 * (qw * qz + qx * qy), 1 - 2 * (qy * qy + qz * qz)) * DEG;
  return { pitch, roll, yaw };
}

// Inverse of toAngles, used by the demo stream
export function fromAngles({ pitch, roll, yaw }) {
  const [cx, sx] = [Math.cos(pitch / DEG / 2), Math.sin(pitch / DEG / 2)];
  const [cy, sy] = [Math.cos(roll / DEG / 2), Math.sin(roll / DEG / 2)];
  const [cz, sz] = [Math.cos(yaw / DEG / 2), Math.sin(yaw / DEG / 2)];
  return {
    qw: cx * cy * cz + sx * sy * sz,
    qx: sx * cy * cz - cx * sy * sz,
    qy: cx * sy * cz + sx * cy * sz,
    qz: cx * cy * sz - sx * sy * cz,
  };
}

// Difference between two angles, wrapped to -180..180
export function angleDelta(a, b) {
  return ((((a - b + 180) % 360) + 360) % 360) - 180;
}

// IMU mounting
// BNO085 sits 90° CCW on the PCB; change IMU_MOUNT_DEG if it moves
export const IMU_MOUNT_DEG = 90;

const mul = (a, b) => ({
  qw: a.qw * b.qw - a.qx * b.qx - a.qy * b.qy - a.qz * b.qz,
  qx: a.qw * b.qx + a.qx * b.qw + a.qy * b.qz - a.qz * b.qy,
  qy: a.qw * b.qy - a.qx * b.qz + a.qy * b.qw + a.qz * b.qx,
  qz: a.qw * b.qz + a.qx * b.qy - a.qy * b.qx + a.qz * b.qw,
});

const half = (IMU_MOUNT_DEG / DEG) / 2;
const MOUNT = { qw: Math.cos(half), qx: 0, qy: 0, qz: Math.sin(half) };
const MOUNT_INV = { qw: MOUNT.qw, qx: 0, qy: 0, qz: -MOUNT.qz };

// Sensor orientation -> board orientation
export function correctMount(q) {
  if (IMU_MOUNT_DEG === 0) return q;
  return mul(mul(MOUNT, q), MOUNT_INV);
}
