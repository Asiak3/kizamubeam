# Drei getrennte lokale Fehlerbehebungs-Scopes

**Update 07.11.:** Veröffentlicht als unabhängige PRs gegen `73e75cb`/2.8.0:
Dateidrop [#168](https://github.com/negurvulkan/kizamubeam/pull/168),
Objektbaum [#172](https://github.com/negurvulkan/kizamubeam/pull/172),
Pinch [#173](https://github.com/negurvulkan/kizamubeam/pull/173).
Alle isoliert gebaut/geprüft; Browser jeweils 5/6/4 Checks und fokussierte
Bridge-/Zoomtests bestanden. Windows Pinch Cargo check offline/locked bestanden.
Benutzer bestätigt Pinch „getestet, works“. Die noch lokale Schlitzvorschau
gehört nicht zum unabhängigen Pinch-PR; Helper bleibt dort separat verdrahtet.
Nachfolgende Beschreibung enthält historische kombinierte Testzahlen.

Nicht mit dem Konturversatz oder den vier veröffentlichten Editor-PRs vermischen.
Ein gemeinsamer Testbuild enthält alle lokalen Funktionen.

## Pinch-Zoom

`src/canvasZoom.ts`, Editor-Pointer/-Verdrahtung, Schlitzdialog. Windows aktiviert
gezielt `IsPinchZoomEnabled`; Browser-Zoom-Hotkeys bleiben aus. Direkte
`webview2-com`/`windows-core`-Abhängigkeiten waren bereits transitiv vorhanden;
Cargo.lock ergänzt nur Kanten, keine Paket-Upgrades. 5 fokussierte Tests und
Ctrl+wheel/Gesture-Browserereignisse auf beiden Canvases bestanden.
Noch offen: echte Touchpad-Abnahme unter Windows/macOS/Linux.

## Bild-/SVG-Drag-and-drop

`src/nativeFileDrop.ts`, `src/files.ts`, Tauri `dragDropEnabled: true`.
Explizite native Dateipfade lesen, keine URL-Downloads; physische Positionen
durch Fenster-Skalierung teilen und bestehende DOM-Importhandler verwenden.
Interne Nicht-Dateidrags bleiben unangetastet. Maximal 100 eindeutige Pfade und
256 MiB nach dem Lesen (keine Vorab-Dateigrößenprüfung); Dokument-/Seitenwechsel
verhindert spätere Zustellung. 5 Bridge-Tests sowie SVG-/Bildbytes, Panelrouting
und interne Drags im Browser bestanden. Kein vollständiger nativer Dateiimport-
End-to-End-Nachweis. Explorer-Drop, HiDPI, Import-Undo und macOS/Linux offen.

## Objekte-Baum

`src/objectsPanel.ts`: alle Palette-Layer initial geschlossen. Gruppen waren
bereits initial geschlossen. Bestehende Sets behalten manuelle Zustände bei
normalen Renderzyklen; kein neues serialisiertes Feld oder App-Neustart-Persistenz.
Reales Panel (Dock-Sichtbarkeit im Test ersetzt) prüft Erstzustand, manuelle
Gruppen-/Layerzustände und neu hinzukommende Layer.

`runInputTreeChecks()` 11/11; Schlitzsuite 96/96; Außenkontur 31/31 und
Konturversatz 27/27 in isoliertem Chromium. Keine App-/Hardware-Inbetriebnahme.

Wesentliche KI-Unterstützung: **GPT 6.1 Sol (OpenAI) via OpenCode**.
