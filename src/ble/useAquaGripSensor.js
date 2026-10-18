import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEVICE_NAME,
  SERVICE_UUID,
  DATA_CHAR_UUID,
  STATUS_CHAR_UUID,
  SERIAL_BAUD,
  decodeReading,
  decodeStatus,
  parseSerialLine,
} from "./protocol";
import { startMockReadings } from "./mockReadings";

// Placeholder until the first real sample arrives (not a measurement).
export const ZERO_READING = { forcePsi: 0, qw: 1, qx: 0, qy: 0, qz: 0 };

const PACKET_BYTES = 20;
const NOTIFY_GRACE_MS = 2000; // no live updates by then -> read values directly
const POLL_GAP_MS = 40;
const MAX_LOG = 40;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const toHex = (dv) =>
  Array.from(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength), (b) => b.toString(16).padStart(2, "0")).join(" ");
const errText = (err) => (err instanceof Error ? err.message : String(err));

const CONNECT_ATTEMPTS = 3;

// Android often drops a brand-new BLE link a moment after it opens (the
// infamous "GATT error 133"), surfacing as "GATT Server is disconnected"
// while looking up services. A short pause and another try usually works.
async function connectWithRetry(device, log) {
  for (let attempt = 1; ; attempt++) {
    try {
      const server = await device.gatt.connect();
      log(attempt === 1 ? "Connected to the device." : `Connected on try ${attempt}.`);
      await sleep(300); // give Android a moment to settle the new link
      if (!device.gatt.connected) throw new Error("The link dropped right after connecting.");
      return await server.getPrimaryService(SERVICE_UUID);
    } catch (err) {
      if (attempt >= CONNECT_ATTEMPTS) throw err;
      log(`Try ${attempt} failed (${errText(err)}). Retrying…`);
      if (device.gatt.connected) device.gatt.disconnect();
      await sleep(600 * attempt);
    }
  }
}

function freshCounters() {
  return { packets: 0, times: [], lastAt: 0, lastLength: null, lastBytes: "", shortPackets: 0, ignoredLines: 0, mode: null };
}

const hex4 = (n) => `0x${n.toString(16).padStart(4, "0")}`;

// Talks to the AquaGrip ESP32 over Web Bluetooth or a USB cable (Web
// Serial), or with mock: true generates a fake reading stream instead.
// Every path exposes the exact same shape, so game/tracker code never needs
// to know which one is active.
export function useAquaGripSensor({ mock = false, transport = "ble" } = {}) {
  const [connectionState, setConnectionState] = useState("disconnected"); // disconnected | connecting | connected
  const [reading, setReading] = useState(ZERO_READING);
  const [status, setStatus] = useState("");
  const [error, setError] = useState(null);

  const deviceRef = useRef(null);
  const portRef = useRef(null); // USB port to reopen without the picker
  const serialRef = useRef(null); // { port, reader, piped } while USB is open
  const stopMockRef = useRef(null);
  // Games read the newest sample from this ref every animation frame, so
  // they never wait for (or trigger) a React re-render to get sensor data.
  const readingRef = useRef(ZERO_READING);
  // When the newest sample arrived; games use it to notice a silent link
  // (Android can take several seconds to report a dropped connection).
  const lastDataAtRef = useRef(0);

  // Diagnostics: what actually arrives over Bluetooth, step by step. Kept in
  // a ref (updated per packet) and copied to state twice a second for the UI.
  const countersRef = useRef(freshCounters());
  const logRef = useRef([]);
  const pollRef = useRef(null);
  const attemptRef = useRef(0); // bumps on every connect, so stale timers from an earlier attempt do nothing
  const [diagnostics, setDiagnostics] = useState({ ...freshCounters(), rateHz: 0, lastAgoS: null, log: [] });

  const log = useCallback((msg) => {
    logRef.current = [...logRef.current.slice(-(MAX_LOG - 1)), { at: Date.now(), msg }];
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      const c = countersRef.current;
      const now = performance.now();
      c.times = c.times.filter((t) => now - t < 1000);
      setDiagnostics({
        ...c,
        times: undefined,
        rateHz: c.times.length,
        lastAgoS: c.lastAt ? (now - c.lastAt) / 1000 : null,
        log: logRef.current,
      });
    }, 500);
    return () => clearInterval(id);
  }, []);

  const publish = useCallback((next) => {
    const now = performance.now();
    const c = countersRef.current;
    c.packets++;
    c.lastAt = now;
    c.times.push(now);
    if (c.times.length > 200) c.times.shift();
    readingRef.current = next;
    lastDataAtRef.current = now;
    setReading(next);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) pollRef.current.stop = true;
    pollRef.current = null;
  }, []);

  // Every packet, from live updates or direct reads, goes through here.
  const handlePacket = useCallback(
    (dv, via) => {
      const c = countersRef.current;
      c.lastLength = dv.byteLength;
      c.lastBytes = toHex(dv);
      if (via === "notify" && pollRef.current) {
        stopPolling();
        c.mode = "notify";
        log("Live updates started arriving, so direct reads stopped.");
      }
      if (dv.byteLength < PACKET_BYTES) {
        c.shortPackets++;
        if (c.shortPackets === 1) {
          log(`Packet is ${dv.byteLength} bytes; expected ${PACKET_BYTES}. The firmware's data format doesn't match the website.`);
        }
        return;
      }
      publish(decodeReading(dv));
    },
    [publish, stopPolling, log]
  );

  // USB: one text line from the firmware's serial output.
  const handleSerialLine = useCallback(
    (line) => {
      const parsed = parseSerialLine(line);
      const c = countersRef.current;
      if (!parsed) {
        if (line.trim() && ++c.ignoredLines <= 3) log(`Ignored a line that isn't sensor data: "${line.trim().slice(0, 60)}"`);
        return;
      }
      if (parsed.type === "header") return;
      if (parsed.type === "status") {
        setStatus(parsed.code);
        log(`Device says: ${parsed.text}`);
        return;
      }
      c.lastBytes = line.trim();
      c.lastLength = null;
      publish(parsed.reading);
    },
    [publish, log]
  );

  // Close the USB port. Order matters: cancel the reader, let the pipe
  // finish, then close the port (it can't close while still being read).
  const closeSerial = useCallback(async () => {
    const s = serialRef.current;
    serialRef.current = null;
    if (!s) return;
    await s.reader.cancel().catch(() => {});
    await s.piped.catch(() => {});
    await s.port.close().catch(() => {});
  }, []);

  const readSerial = useCallback(
    async (port, attempt) => {
      const decoder = new TextDecoderStream();
      const piped = port.readable.pipeTo(decoder.writable);
      const reader = decoder.readable.getReader();
      serialRef.current = { port, reader, piped };
      let buffer = "";
      // We start listening partway through whatever the board is printing,
      // so the first line is usually cut off (e.g. "4.71,..." from
      // "14.71,..."), which would look like a real, very low pressure.
      let firstLine = true;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop();
          if (firstLine && lines.length) {
            lines.shift();
            firstLine = false;
          }
          lines.forEach(handleSerialLine);
        }
      } catch (err) {
        if (attempt === attemptRef.current) log(`USB read stopped: ${errText(err)}`);
      }
      // Still the active attempt => the stream ended on its own (unplugged).
      if (attempt === attemptRef.current) {
        await closeSerial();
        portRef.current = null; // a replugged board is a new port object
        log("USB connection lost. Was the cable unplugged?");
        setConnectionState("disconnected");
      }
    },
    [handleSerialLine, closeSerial, log]
  );

  const disconnect = useCallback(() => {
    attemptRef.current++; // cancel pending checks and mark USB closes as intentional
    stopPolling();
    if (stopMockRef.current) {
      stopMockRef.current();
      stopMockRef.current = null;
    }
    if (deviceRef.current?.gatt?.connected) {
      deviceRef.current.gatt.disconnect();
    }
    deviceRef.current = null;
    closeSerial();
    portRef.current = null;
    setConnectionState("disconnected");
  }, [stopPolling, closeSerial]);

  // Stable listeners, so reconnecting can remove the old ones first and a
  // characteristic never ends up delivering each sample twice.
  const onData = useCallback((event) => handlePacket(event.target.value, "notify"), [handlePacket]);
  const onStatus = useCallback(
    (event) => {
      const code = decodeStatus(event.target.value);
      setStatus(code);
      log(`Device says: ${code}`);
    },
    [log]
  );
  const onDrop = useCallback(() => {
    stopPolling();
    log("Disconnected from the device.");
    setConnectionState("disconnected");
  }, [stopPolling, log]);

  // Fallback when live updates never arrive: ask the device for its newest
  // value about 20 times a second instead.
  const startPolling = useCallback(
    (device, dataChar) => {
      stopPolling();
      const token = { stop: false };
      pollRef.current = token;
      countersRef.current.mode = "polling";
      (async () => {
        while (!token.stop && device.gatt.connected) {
          try {
            handlePacket(await dataChar.readValue(), "read");
          } catch (err) {
            log(`Direct read failed: ${errText(err)}`);
            await sleep(500);
          }
          await sleep(POLL_GAP_MS);
        }
      })();
    },
    [stopPolling, handlePacket, log]
  );

  const connect = useCallback(async () => {
    setError(null);
    stopPolling();
    countersRef.current = freshCounters();
    const attempt = ++attemptRef.current;

    if (mock) {
      setConnectionState("connecting");
      stopMockRef.current?.(); // never run two demo streams at once
      stopMockRef.current = startMockReadings(publish);
      countersRef.current.mode = "demo";
      log("Demo stream started (sample data, no device).");
      setStatus("MOCK");
      setConnectionState("connected");
      return;
    }

    if (transport === "usb") {
      if (!navigator.serial) {
        setError("A USB connection needs Chrome or Edge on a computer.");
        log("This browser can't use USB devices. Use Chrome or Edge on a computer.");
        return;
      }
      await closeSerial();
      const reusing = portRef.current !== null;
      try {
        setConnectionState("connecting");
        let port = portRef.current;
        if (!port) {
          // A port allowed before (e.g. after unplugging and replugging) can
          // be reopened without asking again, as long as it's the only one.
          const granted = await navigator.serial.getPorts();
          if (granted.length === 1) {
            port = granted[0];
            log("Using the USB port you picked before.");
          } else {
            log("Choose the AquaGrip's USB port…");
            port = await navigator.serial.requestPort();
          }
          portRef.current = port;
          const info = port.getInfo?.() ?? {};
          if (info.usbVendorId) {
            log(`USB device: vendor ${hex4(info.usbVendorId)}, product ${hex4(info.usbProductId ?? 0)}.`);
          }
        }
        await port.open({ baudRate: SERIAL_BAUD });
        countersRef.current.mode = "usb";
        log(`USB port open at ${SERIAL_BAUD} baud. Waiting for data…`);
        setStatus("");
        setConnectionState("connected");
        readSerial(port, attempt);
      } catch (err) {
        if (reusing) portRef.current = null;
        const msg = errText(err);
        const busy = /open|in use|access/i.test(msg) && err?.name !== "NotFoundError";
        setError(
          busy
            ? "Couldn't open the USB port. Close the Arduino Serial Monitor (only one program can use the port at a time), then try again."
            : msg
        );
        log(`Error: ${msg}`);
        setConnectionState("disconnected");
      }
      return;
    }

    if (!navigator.bluetooth) {
      setError("Web Bluetooth isn't available in this browser. Use Chrome or Edge.");
      log("This browser has no Web Bluetooth. Use Chrome or Edge.");
      return;
    }

    // After a dropped link, reconnect to the same AquaGrip directly instead
    // of making the player pick it from Chrome's device list again.
    const reusing = deviceRef.current !== null;
    try {
      setConnectionState("connecting");

      let device = deviceRef.current;
      if (!device) {
        log(`Looking for a device named "${DEVICE_NAME}"…`);
        device = await navigator.bluetooth.requestDevice({
          filters: [{ name: DEVICE_NAME }],
          optionalServices: [SERVICE_UUID],
        });
        deviceRef.current = device;
        log(`Picked "${device.name ?? "unnamed device"}".`);
      } else {
        log(`Reconnecting to "${device.name ?? "AquaGrip"}"…`);
      }
      device.removeEventListener("gattserverdisconnected", onDrop);
      device.addEventListener("gattserverdisconnected", onDrop);

      const service = await connectWithRetry(device, log);
      log("Found the AquaGrip service.");

      const dataChar = await service.getCharacteristic(DATA_CHAR_UUID);
      log("Found the sensor-data channel.");
      dataChar.removeEventListener("characteristicvaluechanged", onData);
      dataChar.addEventListener("characteristicvaluechanged", onData);
      await dataChar.startNotifications();
      countersRef.current.mode = "notify";
      log("Asked for live updates. Waiting for data…");

      // Status messages are nice to have; never let them block the data.
      try {
        const statusChar = await service.getCharacteristic(STATUS_CHAR_UUID);
        statusChar.removeEventListener("characteristicvaluechanged", onStatus);
        statusChar.addEventListener("characteristicvaluechanged", onStatus);
        await statusChar.startNotifications();
        const current = decodeStatus(await statusChar.readValue());
        if (current) {
          setStatus(current);
          log(`Device says: ${current}`);
        }
      } catch (err) {
        log(`Status channel unavailable (${errText(err)}). Data can still work.`);
      }

      setConnectionState("connected");

      const packetsAtStart = countersRef.current.packets;
      setTimeout(() => {
        if (attempt !== attemptRef.current) return; // a newer connection owns the link now
        if (device.gatt.connected && countersRef.current.packets === packetsAtStart) {
          log("No live updates after 2 seconds. Reading values directly instead.");
          startPolling(device, dataChar);
        }
      }, NOTIFY_GRACE_MS);
    } catch (err) {
      // If the remembered device can't be reached, the next try shows the picker.
      if (reusing) deviceRef.current = null;
      setError(errText(err));
      log(`Error: ${errText(err)}`);
      setConnectionState("disconnected");
    }
  }, [mock, transport, publish, onData, onStatus, onDrop, log, stopPolling, startPolling, closeSerial, readSerial]);

  // Disconnect cleanly if the component using this hook unmounts.
  useEffect(() => disconnect, [disconnect]);

  return {
    connectionState,
    reading,
    readingRef,
    lastDataAtRef,
    status,
    error,
    diagnostics,
    connect,
    disconnect,
  };
}
