# Außenkontur und Inseln — lokaler Prototyp

## Aktueller Stand 08.11.2026

Drei Ausgabemodi „Nur Außenkontur“, „Außenkontur + Inseln“, „Nur Inseln“;
adaptive Erkennung und Rückführung exakter Quell-Bézierabschnitte statt
grober Ausgabepolygone. Quellkanten nicht mehr durch Toleranzanschlüsse verziehen;
Verbindungen orange markieren, uneindeutige Inseln sperren.34 Geometrie-/Editor-,
39 Browser-,28 Originaldatei-Browserchecks und60 synthetische Fälle bestanden.
Die114-Insel-Screenshotauswahl ist noch nicht identisch reproduziert.
[Bedienung, numerische Grenzen und nächster Schritt](outline-islands.md).
Diese Nacharbeit ist lokal und nicht in #170 veröffentlicht.
Kombinierter Testbuild: `artifacts/windows-outline-islands-20261108-142237/`;
EXE/NSIS,18Prüfbefehle und Quellen-/Binärhashprüfung bestanden, nicht gestartet.

## Historischer Stand vor der Insel-Weiterentwicklung

07.11.: isolierter [PR #170](https://github.com/negurvulkan/kizamubeam/pull/170)
gegen Upstream 2.8.0 veröffentlicht, zunächst **Draft**. 24 Geometrie-/Editor-
und 31 Browserchecks plus Apps/History/G-code/i18n/Build bestanden. Die mögliche
VectorCraft-Codeherkunft/Lizenzzuordnung aus Issue #147 muss vor Merge geprüft
und erforderliche Originalhinweise übernommen werden; keine ungeprüfte
Behauptung einer unabhängigen Reimplementierung. #147 verweist auf den PR.

Die Quellobjekte auswählen und **Außenkontur mit gewählten Löchern …** öffnen.
Das kleine, verschiebbare Werkzeugfenster ist nicht modal: Die Vorschau liegt
als türkis gestrichelte Kontur direkt auf der Arbeitsfläche. Ein Klick auf eine
erkannte Innenfläche schaltet sie als Loch ein oder wieder aus. Die Liste im
Fenster bietet dieselbe Auswahl per Checkbox. Mitteltasten-Pan und Zoom bleiben
verfügbar; gewöhnliche Bearbeitungskürzel sind während der Vorschau gesperrt.

Einstellungen: Verbindungstoleranz (0–0,5 mm), Zielebene und Originale behalten.
Die Toleranz gilt nur für die Auswertung und den neuen Pfad, nie für die Quellen.
Standard ist 0,01 mm. Eine Änderung setzt die Lochauswahl zurück, weil sich die
Flächenzerlegung ändern kann. Ohne geschlossene Fläche bleibt das Fenster zum
Anpassen der Toleranz offen; Anwenden ist gesperrt. Freie Linienenden und die
Anzahl erkannter Außenkonturen werden angezeigt. Größere Lücken werden nicht
überbrückt; es wird weder eine konvexe Hülle noch eine beliebige Schließkante
erzeugt. Kurven werden auf dem vorhandenen 0,001-mm-Raster fein angenähert.

**Anwenden** erzeugt den unabhängigen Pfad in einem Undo-Schritt. Abbrechen oder
Esc entfernt ausschließlich die Vorschau. Originale bleiben standardmäßig
erhalten; Ersetzen erfordert eine Bestätigung. Änderungen an Quelle, Auswahl,
Dokument oder Werkzeug verwerfen die veraltete Vorschau. Ausgabeausschlüsse der
Quellen werden weiterhin auf das Ergebnis übertragen. Gravurvorlage und neue
Schnittkontur bewusst unterschiedlichen Bearbeitungen zuordnen, damit keine
Konturen unbeabsichtigt doppelt geschnitten werden.

## Liniennetz statt pauschaler Ablehnung offener Pfade

Einzelne offene Objekte dürfen gemeinsam Flächen begrenzen. Die neue Auswertung
zerlegt ihre Weltkoordinaten an Schnittpunkten und T-Stößen, entfernt doppelte
Kanten und verfolgt begrenzte Flächen. Abgetrennte Teile bleiben getrennt;
verschachtelte Innenflächen bleiben unabhängig wählbar. Für ausschließlich
geschlossene Quellen bleibt der bisherige Flächenalgorithmus erhalten.
Ressourcenbudgets begrenzen Segmente, Schnittarbeit, Kanten und Flächen.

Die private Beispieldatei `resources/frame_test.kzb` wurde nur gelesen. Das Motiv
aus den Objekten 154–158 liefert mit 0,05 mm eine gemeinsame Außenkontur; bei
0,2 mm entstehen zusätzlich 46 wählbare Innenflächen. Ein freies inneres Ende
verbleibt bei 0,2 mm; die Vorschau muss weiterhin geprüft werden. Die Zeichnung
wird nicht in öffentliche Testfixtures übernommen.

Ausgeführt: 24 Konturtests, 31 Prüfungen im echten Chromium-Editor,
`test:interaction` (21), `test:vector` (9 + 16), `test:gcode`, `build` und
`i18n:check` bestanden (0 fehlende Übersetzungen; 15 unbenutzte Schlüssel).
Browserergebnis: `artifacts/local-prototypes/outline-workspace-results.json`.
Windows-Paketierung bestanden:
`artifacts/windows-outline-workspace-20261107-023218/`,
EXE `KizamuBeam-outline-workspace.exe` und NSIS-Installer. Quell-Hashes nach dem
Build geprüft; nicht gestartet oder installiert. Native Interaktion,
Materialpassung und physischer Schnitt sind nicht durch Browser-/Geometrietests
abgedeckt. Keine Maschinenverbindung oder automatische Ausgabe.

Wesentliche KI-Unterstützung: **GPT 6.1 Sol (OpenAI) via OpenCode**.
