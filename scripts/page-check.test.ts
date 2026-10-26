// Offline-Tests der Seitenprüfungs-Logik. Aufruf: npx tsx --test scripts/page-check.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyStatus,
  controlsHealthy,
  decide,
  looksBlocked,
} from "./lib/page-check";

test("classifyStatus: nur 200 lebt, nur 404/410 ist weg", () => {
  assert.equal(classifyStatus(200), "alive");
  assert.equal(classifyStatus(404), "gone");
  assert.equal(classifyStatus(410), "gone");
  for (const s of [0, 301, 302, 403, 429, 500, 503]) {
    assert.equal(classifyStatus(s), "unknown", `status ${s}`);
  }
});

test("decide: stale nur bei 404 UND vorhandenem (gelöschtem) Bild", () => {
  assert.equal(decide("gone", true), "stale");
  assert.equal(decide("gone", false), "skip"); // leeres media-Array: Beleg 1 fehlt
  assert.equal(decide("alive", true), "touch");
  assert.equal(decide("alive", false), "touch");
  assert.equal(decide("unknown", true), "skip");
});

test("controlsHealthy: Kontrollprobe muss überwiegend 200 liefern", () => {
  assert.equal(controlsHealthy({ alive: 10, gone: 0, unknown: 0 }), true);
  assert.equal(controlsHealthy({ alive: 8, gone: 1, unknown: 1 }), true);
  assert.equal(controlsHealthy({ alive: 2, gone: 8, unknown: 0 }), false); // URL-Format gekippt
  assert.equal(controlsHealthy({ alive: 0, gone: 0, unknown: 10 }), false); // geblockt
  assert.equal(controlsHealthy({ alive: 0, gone: 0, unknown: 0 }), false); // keine Kontrollen
});

test("looksBlocked: erst ab Stichprobe, dann bei > 50 % unklar", () => {
  assert.equal(looksBlocked({ alive: 0, gone: 0, unknown: 40 }), false); // zu wenige
  assert.equal(looksBlocked({ alive: 5, gone: 40, unknown: 10 }), false); // erwartetes Bild
  assert.equal(looksBlocked({ alive: 2, gone: 10, unknown: 40 }), true);
});
