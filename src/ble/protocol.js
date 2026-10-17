import { correctMount } from "./orientation";

// Must match xiao_sensor_firmware_ble.ino exactly -- these UUIDs and the
// byte layout below are the contract between the firmware and the app.
export const DEVICE_NAME = "AquaGrip";
export const SERVICE_UUID = "a495ff10-c5b1-4b44-b512-1370f02d74de";
export const DATA_CHAR_UUID = "a495ff11-c5b1-4b44-b512-1370f02d74de";
export const STATUS_CHAR_UUID = "a495ff12-c5b1-4b44-b512-1370f02d74de";

// The data characteristic is 5 little-endian float32s, in this order:
// force_psi, qw, qx, qy, qz (20 bytes total -- see the firmware's header
// comment for why that size was chosen). The quaternion is corrected for how
// the IMU is mounted on the PCB (see orientation.js).
export function decodeReading(dataView) {
  return {
    forcePsi: dataView.getFloat32(0, true),
    ...correctMount({
      qw: dataView.getFloat32(4, true),
      qx: dataView.getFloat32(8, true),
      qy: dataView.getFloat32(12, true),
      qz: dataView.getFloat32(16, true),
    }),
  };
}

const textDecoder = new TextDecoder();

export function decodeStatus(dataView) {
  return textDecoder.decode(dataView);
}

// ---- USB (serial) ----
// The firmware also prints every reading over USB at 115200 baud as a text
// line "force_psi,qw,qx,qy,qz", plus "STATUS,..." lines and a header row.
export const SERIAL_BAUD = 115200;

// Serial STATUS names -> the short codes the Bluetooth status channel uses.
const SERIAL_STATUS_CODES = {
  BOOT: "BOOT",
  MPRLS_OK: "MPR_OK",
  BNO085_OK: "BNO_OK",
  RETRY_INIT: "RETRY",
  BNO085_RESET: "BNO_RESET",
  BLE_CONNECTED: "BLE_CONN",
  BLE_DISCONNECTED: "BLE_DISC",
};

// Returns { type: "data", reading } | { type: "status", code, text } |
// { type: "header" } | null (not ours, e.g. boot noise).
export function parseSerialLine(line) {
  const text = line.trim();
  if (!text) return null;
  if (text.startsWith("force_psi,")) return { type: "header" }; // the firmware's column names
  if (text.startsWith("STATUS,")) {
    const name = text.split(",")[1] ?? "";
    return { type: "status", code: SERIAL_STATUS_CODES[name] ?? name, text };
  }
  const parts = text.split(",");
  if (parts.length !== 5) return null;
  const nums = parts.map(Number);
  if (!nums.every(Number.isFinite)) return null; // e.g. the header row
  const [forcePsi, qw, qx, qy, qz] = nums;
  return { type: "data", reading: { forcePsi, ...correctMount({ qw, qx, qy, qz }) } };
}
