/*
  xiao_sensor_firmware_ble.ino

  BLE version of xiao_sensor_firmware.ino, for the Seeed XIAO ESP32C3.
  Same two sensors, same reading/retry/smoothing logic -- the only real
  change is the output layer: instead of (or alongside) printing a CSV
  line over USB serial, sensor readings are packed into a BLE GATT
  characteristic and pushed to a subscribed browser via notify(), so the
  AquaGrip web app can connect over Web Bluetooth with the laptop/phone
  untethered from USB.

    - Adafruit MPRLS pressure sensor (0-25 PSI) -> grip/squeeze force
    - BNO085 9-DOF IMU (via Adafruit's BNO08x library) -> wrist orientation

  Both sensors sit on the same I2C bus (SDA/SCL on the XIAO's onboard
  STEMMA QT connector, or D4/D5 if wired manually) at their default,
  non-conflicting addresses: MPRLS = 0x18, BNO085 = 0x4A (or 0x4B if its
  ADR pin is pulled high).

  ---------------------------------------------------------------------
  BLE layout
  ---------------------------------------------------------------------
  Advertised name: "AquaGrip" -- filter on this in the web app's
  navigator.bluetooth.requestDevice() call so the browser's device
  picker doesn't show every random BLE gadget nearby.

  One custom service with two characteristics:

    DATA_CHAR   (read, notify) -- the live sensor reading, updated at
                ~50 Hz. Payload is exactly 20 bytes: five 4-byte
                float32s, little-endian, in this order:
                    force_psi, qw, qx, qy, qz
                20 bytes is deliberate -- it's the largest notification
                payload guaranteed to fit in a *default* ATT_MTU (23
                bytes - 3 bytes ATT header = 20) without any MTU
                negotiation. Web Bluetooth doesn't give page JS control
                over MTU negotiation (the browser/OS handles it), so
                staying under that floor means the data channel works
                the same whether or not a larger MTU got negotiated.
                On the JS side: read each float with
                DataView.getFloat32(offset, true) -- true = little-endian.

    STATUS_CHAR (read, notify) -- a short status code string, updated on
                every state change (boot, sensor found, retry, BLE
                connect/disconnect). Short codes only (see STATUS_*
                constants below) -- same 20-byte notify ceiling applies,
                and these need to be short anyway for the app to just
                switch on them. The original, more detailed STATUS,...
                lines still go to Serial unchanged, for anyone debugging
                with the Serial Monitor.

  The UUIDs below are arbitrary but must match whatever the web app's
  Web Bluetooth code filters/subscribes to -- if you regenerate them,
  update both sides together.

  ---------------------------------------------------------------------
  Everything below this point that ISN'T about BLE (sensor init/retry,
  pressure smoothing and range-checking, the "why" of the game rotation
  vector, reliability notes) is unchanged from xiao_sensor_firmware.ino.
  ---------------------------------------------------------------------
  Expected behavior that is NOT a bug: yaw (left/right rotation) will
  slowly drift over a long session even if the wrist is held still. The
  game rotation vector deliberately excludes the magnetometer (to avoid
  glitches from nearby metal/magnets), which means yaw has no absolute
  compass reference and drifts like a gyroscope does. Pitch and roll stay
  accurate indefinitely because they're referenced to gravity. This is a
  known tradeoff, not something to try to "fix" in firmware.

  Libraries needed (Arduino Library Manager):
    - "Adafruit MPRLS Library"
    - "Adafruit BNO08x"
    - "Adafruit BusIO" (dependency, usually auto-installed)
    - BLE support (BLEDevice.h, BLEServer.h, BLEUtils.h, BLE2902.h) ships
      with the "esp32" boards package (Espressif) -- if these headers
      don't resolve, update that board package in Boards Manager. The
      XIAO ESP32C3 has BLE 5.0 only (no classic Bluetooth), which is all
      Web Bluetooth needs.

  Board setup:
    - Install "esp32" boards package (Espressif) in Boards Manager
    - Select board: "XIAO_ESP32C3"

  Before connecting from the web app, open the Arduino Serial Monitor
  (115200 baud) first and confirm you see STATUS,MPRLS_OK and
  STATUS,BNO085_OK, then squeeze / tilt and watch the numbers change.
  That confirms the hardware is good before you add BLE on top of it.
*/

#include <math.h>
#include <Wire.h>
#include "Adafruit_MPRLS.h"
#include <Adafruit_BNO08x.h>

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

const char *FW_VERSION = "aquagrip-fw-ble-4";

// ---- Connection switch ----
// The website can connect over Bluetooth OR a USB cable (Chrome/Edge on a
// computer, "USB cable" in the Games tab). USB always works: every reading
// is printed over Serial below either way.
//   1 = Bluetooth on (normal)
//   0 = Bluetooth off, USB only. Use this to rule out Bluetooth problems,
//       e.g. if the board restarts when something connects over Bluetooth.
#define ENABLE_BLE 1

// ---- BLE identity ----
#define BLE_DEVICE_NAME "AquaGrip"
#define SERVICE_UUID      "a495ff10-c5b1-4b44-b512-1370f02d74de"
#define DATA_CHAR_UUID    "a495ff11-c5b1-4b44-b512-1370f02d74de"
#define STATUS_CHAR_UUID  "a495ff12-c5b1-4b44-b512-1370f02d74de"

// Short status codes sent over BLE (kept <20 bytes -- see header comment).
// The existing verbose Serial STATUS,... lines are unchanged and still
// carry the full detail for USB debugging.
#define STATUS_BOOT             "BOOT"
#define STATUS_MPR_OK           "MPR_OK"
#define STATUS_BNO_OK           "BNO_OK"
#define STATUS_RETRY            "RETRY"
#define STATUS_BNO_RESET        "BNO_RESET"
#define STATUS_BLE_CONNECTED    "BLE_CONN"
#define STATUS_BLE_DISCONNECTED "BLE_DISC"

BLEServer *bleServer = nullptr;
BLECharacteristic *dataChar = nullptr;
BLECharacteristic *statusChar = nullptr;
bool deviceConnected = false;

// Sets the status characteristic's value and notifies if a client is
// connected; always safe to call even before advertising starts.
void bleStatus(const char *code) {
  if (!statusChar) return;
  statusChar->setValue((uint8_t *)code, strlen(code));
  if (deviceConnected) {
    statusChar->notify();
  }
}

class AquaGripServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *server) override {
    deviceConnected = true;
    Serial.println("STATUS,BLE_CONNECTED");
    bleStatus(STATUS_BLE_CONNECTED);
  }
  void onDisconnect(BLEServer *server) override {
    deviceConnected = false;
    Serial.println("STATUS,BLE_DISCONNECTED");
    // Re-advertise so the web app can reconnect without a board reset.
    BLEDevice::startAdvertising();
  }
};

void setupBLE() {
  BLEDevice::init(BLE_DEVICE_NAME);
  bleServer = BLEDevice::createServer();
  bleServer->setCallbacks(new AquaGripServerCallbacks());

  BLEService *service = bleServer->createService(SERVICE_UUID);

  dataChar = service->createCharacteristic(
      DATA_CHAR_UUID,
      BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  dataChar->addDescriptor(new BLE2902());

  statusChar = service->createCharacteristic(
      STATUS_CHAR_UUID,
      BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  statusChar->addDescriptor(new BLE2902());

  service->start();

  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->setScanResponse(true);
  BLEDevice::startAdvertising();

  bleStatus(STATUS_BOOT);
}

// Packs the 5 floats into a little-endian 20-byte buffer and notifies.
// ESP32 is natively little-endian, so this is just a raw memcpy -- no
// byte-swapping needed to match DataView.getFloat32(offset, true) on
// the JS side.
void sendReadingBLE(float force_psi, float qw, float qx, float qy, float qz) {
  if (!dataChar || !deviceConnected) return;
  uint8_t buf[20];
  memcpy(buf + 0,  &force_psi, 4);
  memcpy(buf + 4,  &qw,        4);
  memcpy(buf + 8,  &qx,        4);
  memcpy(buf + 12, &qy,        4);
  memcpy(buf + 16, &qz,        4);
  dataChar->setValue(buf, 20);
  dataChar->notify();
}

// ---- MPRLS setup ----
// No reset/EOC pins wired -> pass -1 for both
#define MPRLS_RESET_PIN -1
#define MPRLS_EOC_PIN -1
Adafruit_MPRLS mpr = Adafruit_MPRLS(MPRLS_RESET_PIN, MPRLS_EOC_PIN);

// ---- BNO085 setup ----
// I2C mode doesn't need a reset pin either
#define BNO08X_RESET -1
Adafruit_BNO08x bno08x(BNO08X_RESET);
sh2_SensorValue_t sensorValue;

// How often we send a combined reading, in milliseconds.
// (The IMU itself reports faster than this internally; we just sample it.)
const unsigned long PRINT_INTERVAL_MS = 20;   // ~50 Hz
unsigned long lastPrintTime = 0;

// How often to retry initializing a sensor that wasn't found yet.
const unsigned long RETRY_INTERVAL_MS = 2000; // 2s
unsigned long lastRetryTime = 0;

// Pressure smoothing: higher = less smoothing / more responsive,
// lower = smoother / more lag. 1.0 disables smoothing entirely.
const float PRESSURE_EMA_ALPHA = 0.35f;
float pressureFiltered = 0.0f;
bool havePressureBaseline = false;

bool mprReady = false;
bool bnoReady = false;

// ---- BNO085 recovery ----
// The BNO085 occasionally resets (power dip, I2C glitch). After a reset it
// forgets which reports it was sending, so orientation -- and with it every
// reading we send -- stops until the report is turned back on. Right after a
// reset the chip is still booting and may refuse, so keep retrying, and watch
// for the data stopping for any other reason too.
bool bnoReportsOn = false;                           // game rotation vector enabled?
unsigned long lastReportAttemptMs = 0;
const unsigned long REPORT_RETRY_MS = 250;           // retry enabling this often
unsigned long lastOrientationMs = 0;                 // last orientation update seen
const unsigned long STALL_REENABLE_MS = 1000;        // silent this long -> turn the report on again
const unsigned long STALL_REINIT_MS = 4000;          // still silent -> restart the sensor completely

// Conversion helper: MPRLS reports hPa natively
float hPaToPsi(float hPa) {
  return hPa / 68.947572932f;
}

// Ask the BNO085 for the sensor report(s) we want.
// Game Rotation Vector = orientation quaternion without magnetometer,
// which avoids magnetic-interference glitches -- good enough for a game
// input, at the cost of slow yaw drift (see the note at the top of the file).
// Returns whether it worked; loop() keeps retrying until it does.
bool setReports() {
  lastReportAttemptMs = millis();
  bnoReportsOn = bno08x.enableReport(SH2_GAME_ROTATION_VECTOR);
  if (!bnoReportsOn) {
    Serial.println("STATUS,ENABLE_REPORT_FAILED");
  }
  return bnoReportsOn;
}

// Try to bring up whichever sensor(s) aren't ready yet. Safe to call
// repeatedly -- already-ready sensors are left alone. Called once from
// setup() and then again from loop() every RETRY_INTERVAL_MS until both
// report ready, so a loose connector fixed mid-session recovers on its
// own instead of needing a manual reset.
void tryInitSensors() {
  if (!mprReady) {
    if (mpr.begin()) {
      mprReady = true;
      Serial.println("STATUS,MPRLS_OK");
      bleStatus(STATUS_MPR_OK);
    }
  }
  if (!bnoReady) {
    if (bno08x.begin_I2C()) {
      bnoReady = true;
      lastOrientationMs = millis(); // start the stall watchdog fresh
      setReports();
      Serial.println("STATUS,BNO085_OK");
      bleStatus(STATUS_BNO_OK);
    }
  }
}

// Read + smooth the pressure sensor. Returns false (and leaves outPsi
// untouched) if the reading looks like a bad I2C transaction rather than
// a real value, so the caller can just skip this print cycle.
bool readPressurePsi(float &outPsi) {
  float hpa = mpr.readPressure();
  float psi = hPaToPsi(hpa);

  // MPRLS is rated 0-25 psi. A little negative slack covers normal
  // zero-offset noise at rest; anything past that (or NaN) means the I2C
  // transaction itself was bad, not that someone pulled a real vacuum.
  if (isnan(psi) || psi < -2.0f || psi > 30.0f) {
    return false;
  }

  if (!havePressureBaseline) {
    pressureFiltered = psi;
    havePressureBaseline = true;
  } else {
    pressureFiltered = PRESSURE_EMA_ALPHA * psi + (1.0f - PRESSURE_EMA_ALPHA) * pressureFiltered;
  }
  outPsi = pressureFiltered;
  return true;
}

void setup() {
  Serial.begin(115200);
#if ARDUINO_USB_CDC_ON_BOOT
  // With the board plugged into a computer but no program reading the port
  // (Serial Monitor closed), USB serial writes otherwise wait ~100 ms each
  // for a reader. That stalled loop() and throttled Bluetooth to a trickle.
  // 0 = never wait: if nobody's reading, the text is simply dropped.
  Serial.setTxTimeoutMs(0);
#endif
  unsigned long start = millis();
  while (!Serial && millis() - start < 3000) delay(10); // don't hang forever if no PC attached

  Wire.begin(); // XIAO ESP32C3 default I2C pins (SDA/SCL / STEMMA QT)

  Serial.print("STATUS,BOOT,fw=");
  Serial.println(FW_VERSION);

#if ENABLE_BLE
  setupBLE();
#else
  Serial.println("STATUS,BLE_DISABLED");
#endif

  tryInitSensors();
  lastRetryTime = millis();

  // Header row so the Python side (or a human) knows the column order,
  // for anyone still using Serial for debugging. The BLE data channel
  // doesn't need this -- its format is fixed and documented above.
  Serial.println("force_psi,qw,qx,qy,qz");
}

void loop() {
  // BNO085 is required -- without orientation there's nothing to send at
  // all. MPRLS is optional: if it's not ready yet, we still send data
  // (with a placeholder pressure) so you can bring up/test the IMU alone
  // and plug in the pressure sensor later without touching the firmware.
  if (!bnoReady) {
    unsigned long now = millis();
    if (now - lastRetryTime >= RETRY_INTERVAL_MS) {
      lastRetryTime = now;
      Serial.print("STATUS,RETRY_INIT,mpr=");
      Serial.print(mprReady ? "ok" : "missing");
      Serial.print(",bno=");
      Serial.println(bnoReady ? "ok" : "missing");
      bleStatus(STATUS_RETRY);
      tryInitSensors();
    }
    return;
  }

  // MPRLS may still be missing even though BNO085 is up -- keep retrying
  // it in the background (same cadence as above) so plugging it in later
  // gets picked up automatically, with no interruption to the data stream
  // that's already flowing.
  if (!mprReady) {
    unsigned long now = millis();
    if (now - lastRetryTime >= RETRY_INTERVAL_MS) {
      lastRetryTime = now;
      Serial.println("STATUS,RETRY_INIT,mpr=missing,bno=ok");
      bleStatus(STATUS_RETRY);
      tryInitSensors();
    }
  }

  // BNO085 can signal it was reset (e.g. brown-out) -- if so, re-enable
  // reports. It doesn't need reinitializing through tryInitSensors(); the
  // chip is still there, it just forgot which reports it was sending.
  if (bno08x.wasReset()) {
    Serial.println("STATUS,BNO085_RESET");
    bleStatus(STATUS_BNO_RESET);
    setReports();
  }

  // Report not on yet (e.g. the chip refused while still rebooting)? Keep
  // asking until it is -- before, one failed attempt left it off for good.
  unsigned long now = millis();
  if (!bnoReportsOn && now - lastReportAttemptMs >= REPORT_RETRY_MS) {
    if (setReports()) Serial.println("STATUS,BNO085_REPORTS_ON");
  }

  // getSensorEvent() is non-blocking: returns false if nothing new is ready yet.
  bool gotOrientation = bno08x.getSensorEvent(&sensorValue) &&
                         sensorValue.sensorId == SH2_GAME_ROTATION_VECTOR;
  now = millis();
  if (gotOrientation) lastOrientationMs = now;

  // Stall watchdog: orientation normally arrives ~100 times a second. If it
  // goes quiet (a reset the chip didn't report, a glitched I2C read...),
  // first turn the report on again; if that doesn't bring it back, restart
  // the sensor from scratch (tryInitSensors() above retries every 2 s).
  unsigned long silentMs = now - lastOrientationMs;
  if (silentMs >= STALL_REINIT_MS) {
    Serial.println("STATUS,BNO085_STALLED,reinit");
    bleStatus(STATUS_BNO_RESET);
    bnoReady = false;
    bnoReportsOn = false;
    lastRetryTime = now - RETRY_INTERVAL_MS; // try again right away
    return;
  }
  if (silentMs >= STALL_REENABLE_MS && now - lastReportAttemptMs >= STALL_REENABLE_MS) {
    Serial.println("STATUS,BNO085_STALLED,reenable");
    setReports();
  }
  if (gotOrientation && (now - lastPrintTime >= PRINT_INTERVAL_MS)) {
    lastPrintTime = now;

    float pressure_psi = 0.0f; // placeholder until MPRLS is connected
    if (mprReady && !readPressurePsi(pressure_psi)) {
      return; // bad reading this cycle -- next cycle (20ms later) will very likely be fine
    }

    float qw = sensorValue.un.gameRotationVector.real;
    float qx = sensorValue.un.gameRotationVector.i;
    float qy = sensorValue.un.gameRotationVector.j;
    float qz = sensorValue.un.gameRotationVector.k;

    // Bluetooth first: it must never wait on USB.
    sendReadingBLE(pressure_psi, qw, qx, qy, qz);

    // The same reading as one CSV line over USB (the website's "USB cable"
    // mode and the Serial Monitor read this). Built once and written in a
    // single call, and only if there's room, so a slow or absent reader can
    // never hold up the loop -- or Bluetooth with it.
    char line[80];
    int len = snprintf(line, sizeof(line), "%.4f,%.4f,%.4f,%.4f,%.4f\r\n",
                       pressure_psi, qw, qx, qy, qz);
    if (len > 0 && Serial.availableForWrite() >= len) {
      Serial.write(line, len);
    }
  }
}
