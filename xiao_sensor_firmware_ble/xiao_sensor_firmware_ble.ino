/*
  AirGrip firmware (BLE + USB) for the Seeed XIAO ESP32C3
  MPRLS pressure (0x18) + BNO085 IMU (0x4A) on I2C

  BLE: service a495ff10, DATA a495ff11 = 20 bytes, 5 LE float32s
       (force_psi, qw, qx, qy, qz); STATUS a495ff12 = short code string
  USB: same reading as a CSV line at 115200 baud

  Yaw drifts slowly: game rotation vector has no magnetometer (expected)
  Libraries: Adafruit MPRLS, Adafruit BNO08x, Adafruit BusIO; board XIAO_ESP32C3
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
// 1 = Bluetooth + USB, 0 = USB only (for ruling out BLE problems)
#define ENABLE_BLE 1

// ---- BLE identity ----
#define BLE_DEVICE_NAME "AquaGrip"
#define SERVICE_UUID      "a495ff10-c5b1-4b44-b512-1370f02d74de"
#define DATA_CHAR_UUID    "a495ff11-c5b1-4b44-b512-1370f02d74de"
#define STATUS_CHAR_UUID  "a495ff12-c5b1-4b44-b512-1370f02d74de"

// Short status codes sent over BLE (<20 bytes); Serial keeps the full detail
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

// Safe to call before advertising starts
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
    // Re-advertise so the app can reconnect
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

// Packs the 5 floats (ESP32 is little-endian, so plain memcpy)
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

// Send rate
const unsigned long PRINT_INTERVAL_MS = 20;   // ~50 Hz
unsigned long lastPrintTime = 0;

// Retry rate for a sensor that isn't found yet
const unsigned long RETRY_INTERVAL_MS = 2000; // 2s
unsigned long lastRetryTime = 0;

// Pressure EMA: higher = more responsive, 1.0 = off
const float PRESSURE_EMA_ALPHA = 0.35f;
float pressureFiltered = 0.0f;
bool havePressureBaseline = false;

bool mprReady = false;
bool bnoReady = false;

// ---- BNO085 recovery ----
// After a reset the chip forgets its reports; keep re-enabling and watch for stalls
bool bnoReportsOn = false;                           // game rotation vector enabled?
unsigned long lastReportAttemptMs = 0;
const unsigned long REPORT_RETRY_MS = 250;           // retry enabling this often
unsigned long lastOrientationMs = 0;                 // last orientation update seen
const unsigned long STALL_REENABLE_MS = 1000;        // silent this long -> turn the report on again
const unsigned long STALL_REINIT_MS = 4000;          // still silent -> restart the sensor completely

// MPRLS reports hPa
float hPaToPsi(float hPa) {
  return hPa / 68.947572932f;
}

// Game rotation vector (no magnetometer); returns false so loop() retries
bool setReports() {
  lastReportAttemptMs = millis();
  bnoReportsOn = bno08x.enableReport(SH2_GAME_ROTATION_VECTOR);
  if (!bnoReportsOn) {
    Serial.println("STATUS,ENABLE_REPORT_FAILED");
  }
  return bnoReportsOn;
}

// Brings up any sensor not ready yet; safe to call repeatedly
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

// Returns false on a bad I2C read so this cycle is skipped
bool readPressurePsi(float &outPsi) {
  float hpa = mpr.readPressure();
  float psi = hPaToPsi(hpa);

  // Rated 0-25 psi; far outside that (or NaN) is a bad read
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
  // Don't block on USB writes when nothing is reading the port
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

  // CSV header for Serial readers
  Serial.println("force_psi,qw,qx,qy,qz");
}

void loop() {
  // BNO085 is required; MPRLS is optional (pressure placeholder until found)
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

  // Keep retrying a missing MPRLS without stopping the stream
  if (!mprReady) {
    unsigned long now = millis();
    if (now - lastRetryTime >= RETRY_INTERVAL_MS) {
      lastRetryTime = now;
      Serial.println("STATUS,RETRY_INIT,mpr=missing,bno=ok");
      bleStatus(STATUS_RETRY);
      tryInitSensors();
    }
  }

  // Chip reset itself: just re-enable reports
  if (bno08x.wasReset()) {
    Serial.println("STATUS,BNO085_RESET");
    bleStatus(STATUS_BNO_RESET);
    setReports();
  }

  // Keep asking until the report is on
  unsigned long now = millis();
  if (!bnoReportsOn && now - lastReportAttemptMs >= REPORT_RETRY_MS) {
    if (setReports()) Serial.println("STATUS,BNO085_REPORTS_ON");
  }

  // Non-blocking
  bool gotOrientation = bno08x.getSensorEvent(&sensorValue) &&
                         sensorValue.sensorId == SH2_GAME_ROTATION_VECTOR;
  now = millis();
  if (gotOrientation) lastOrientationMs = now;

  // Stall watchdog: re-enable after 1 s of silence, full re-init after 4 s
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
      return; // bad read, try next cycle
    }

    float qw = sensorValue.un.gameRotationVector.real;
    float qx = sensorValue.un.gameRotationVector.i;
    float qy = sensorValue.un.gameRotationVector.j;
    float qz = sensorValue.un.gameRotationVector.k;

    // BLE first; it must never wait on USB
    sendReadingBLE(pressure_psi, qw, qx, qy, qz);

    // Same reading over USB, written only if the buffer has room
    char line[80];
    int len = snprintf(line, sizeof(line), "%.4f,%.4f,%.4f,%.4f,%.4f\r\n",
                       pressure_psi, qw, qx, qy, qz);
    if (len > 0 && Serial.availableForWrite() >= len) {
      Serial.write(line, len);
    }
  }
}
