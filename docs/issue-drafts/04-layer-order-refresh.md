# Fehler: Layer-Liste aktualisiert sich nach ▲/▼ erst bei weiterem Klick

Veröffentlicht: https://github.com/negurvulkan/kizamubeam/issues/143.

## Umgebung

Windows, KizamuBeam 2.7.0, lokaler Testbuild auf Basis von `480d5b1` mit
Editor-Prototypen. Die betroffene Fokusprüfung ist bereits im Baseline-Code
vorhanden; sie wurde nicht für die neuen Vektorwerkzeuge eingeführt.

## Reproduktion

1. Neues Projekt mit Objekten auf mindestens zwei Layern anlegen.
2. Im Fenster „Schnitte / Layer“ einen Layer auswählen.
3. Den Button ▲ oder ▼ zum Ändern der Ausgabereihenfolge anklicken.
4. Die Liste beobachten, ohne anschließend in die Layer-Liste zu klicken.

**Erwartet:** Die neue Reihenfolge wird unmittelbar sichtbar.

**Tatsächlich:** Die Liste bleibt zunächst unverändert. Ein weiterer Klick
auf einen Layer bzw. ein späterer Fokuswechsel macht die Änderung sichtbar.
Intern wurden die Layer-Prioritäten bereits geändert. Die veraltete Anzeige
kann deshalb einen falschen Eindruck von der aktuellen Ausgabereihenfolge geben.

## Ursache und lokaler Fix

`buildLayers()` in `src/ui.ts` verwirft den geplanten Neuaufbau, solange irgendein
Element im Panel fokussiert ist. Das schließt den gerade betätigten Pfeilbutton
ein. Der Fix schützt weiterhin aktive Eingabefelder und Auswahlfelder, blockiert
aber nicht mehr wegen eines fokussierten Aktionsbuttons.

Keine Änderung an Prioritätenberechnung, Jobgenerierung, Controllerbefehlen,
Dateiformat oder Einstellungen. Es geht ausschließlich um die Anzeige.

## Verifikation

Die isolierte Browser-Fixture `scripts/layers-browser-fixture.mjs` verwendet die
tatsächliche `buildLayers()`-Funktion und tatsächliche Layer-Reihenfolgemethoden.
Frame-/Timer-Queues werden deterministisch abgearbeitet; DOM und Fokus sind echt.

- Gegenprobe mit alter Fokusbedingung (`--before-fix`): Test für den fokussierten
  Aufwärtsbutton schlägt fehl.
- Mit Fix: keine Fehler; Auf/Ab sofort sichtbar, aktiver Layer bleibt erhalten,
  ein Snapshot je Verschiebung, aktive Texteingabe und Modusauswahl bleiben
  erhalten, Übernahme nach Fokuswechsel geprüft.
- `npm run build`, `npm run test:check`, `npm run test:interaction`,
  `npm run test:gcode`, `npm run i18n:check`: bestanden.

Kein Hardwaretest. Der bereits erstellte Windows-Testbuild enthält diesen
nachträglichen Fix noch nicht; native WebView-Abnahme steht aus. Für dieses
Problem ist keine private Projektdatei als Anhang erforderlich.

## KI-Unterstützung

Analyse, lokaler Fix, Test-Fixture und Entwurf wurden wesentlich mit **GPT 6.1 Sol
(OpenAI) via OpenCode** erstellt. Automatisierte Prüfungen ersetzen keine
unabhängige menschliche Prüfung. Als Issue veröffentlicht; kein PR erfolgt.
