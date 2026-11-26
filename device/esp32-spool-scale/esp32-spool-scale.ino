/*
 * ESP32 spool scale — 4 independent load cells (HX711), HTTP JSON API.
 *
 * Питание HX711 от 3.3V ESP32 (модули обычно работают от 3.3V).
 * Если модуль требует 5V — между DT и GPIO нужен логический level shifter.
 *
 * Пины (можно поменять в config.h):
 *   lane1: DT=16 SCK=17
 *   lane2: DT=18 SCK=19
 *   lane3: DT=21 SCK=22
 *   lane4: DT=25 SCK=26
 */
#include <WiFi.h>
#include <WebServer.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <HX711.h>

const char* WIFI_SSID = "YOUR_WIFI";
const char* WIFI_PASS = "YOUR_PASSWORD";

struct Lane {
  uint8_t dt;
  uint8_t sck;
  HX711 scale;
  float calibration; // units per gram
  float tare;
  float grams;
  bool stable;
};

Lane lanes[4] = {
  {16, 17, HX711(), 1.0f, 0.0f, 0.0f, false},
  {18, 19, HX711(), 1.0f, 0.0f, 0.0f, false},
  {21, 22, HX711(), 1.0f, 0.0f, 0.0f, false},
  {25, 26, HX711(), 1.0f, 0.0f, 0.0f, false},
};

WebServer server(80);
Preferences prefs;
unsigned long lastSample = 0;

void loadConfig() {
  prefs.begin("spoolscale", false);
  for (int i = 0; i < 4; i++) {
    lanes[i].calibration = prefs.getFloat(("cal" + String(i)).c_str(), 1.0f);
    lanes[i].tare = prefs.getFloat(("tare" + String(i)).c_str(), 0.0f);
  }
  prefs.end();
}

void saveLane(int i) {
  prefs.begin("spoolscale", false);
  prefs.putFloat(("cal" + String(i)).c_str(), lanes[i].calibration);
  prefs.putFloat(("tare" + String(i)).c_str(), lanes[i].tare);
  prefs.end();
}

void sample() {
  for (int i = 0; i < 4; i++) {
    if (!lanes[i].scale.is_ready()) continue;
    float raw = lanes[i].scale.get_units(5);
    float g = (raw - lanes[i].tare) / lanes[i].calibration;
    // простой фильтр: сглаживание и «стабильность» поmallому разбросу
    lanes[i].grams = lanes[i].grams * 0.8f + g * 0.2f;
    lanes[i].stable = fabs(g - lanes[i].grams) < 3.0f;
  }
}

void sendJson(String json) {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "application/json", json);
}

void handleWeight() {
  StaticJsonDocument<512> doc;
  JsonArray arr = doc.createNestedArray("lanes");
  for (int i = 0; i < 4; i++) {
    JsonObject o = arr.createNestedObject();
    o["lane"] = i + 1;
    o["grams"] = round(lanes[i].grams * 10) / 10.0;
    o["stable"] = lanes[i].stable;
  }
  String out;
  serializeJson(doc, out);
  sendJson(out);
}

void handleTare() {
  int lane = server.arg("lane").toInt() - 1;
  if (lane < 0 || lane > 3) { server.send(400, "text/plain", "lane 1..4"); return; }
  lanes[lane].tare = lanes[lane].scale.get_units(10);
  saveLane(lane);
  server.send(200, "text/plain", "ok");
}

void handleCalibrate() {
  int lane = server.arg("lane").toInt() - 1;
  float known = server.arg("known").toFloat(); // вес эталона в граммах
  if (lane < 0 || lane > 3 || known <= 0) { server.send(400, "text/plain", "lane 1..4, known>0"); return; }
  float raw = lanes[lane].scale.get_units(10) - lanes[lane].tare;
  lanes[lane].calibration = raw / known;
  saveLane(lane);
  server.send(200, "text/plain", "ok");
}

void handleRoot() {
  server.send(200, "text/plain", "ESP32 spool scale. GET /weight, POST /tare?lane=N, POST /calibrate?lane=N&known=GRAM");
}

void setup() {
  Serial.begin(115200);
  loadConfig();
  for (int i = 0; i < 4; i++) {
    lanes[i].scale.begin(lanes[i].dt, lanes[i].sck);
    lanes[i].scale.set_scale(lanes[i].calibration);
    lanes[i].scale.tare();
  }
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) { delay(300); }
  server.on("/", handleRoot);
  server.on("/weight", handleWeight);
  server.on("/tare", HTTP_POST, handleTare);
  server.on("/calibrate", HTTP_POST, handleCalibrate);
  server.begin();
  Serial.println(WiFi.localIP());
}

void loop() {
  server.handleClient();
  if (millis() - lastSample > 200) { // 5 Hz
    sample();
    lastSample = millis();
  }
}
