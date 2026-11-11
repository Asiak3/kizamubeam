# Lokale Funktions- und PR-Übersicht

## Aktuell: Insel-Kurvenprüfung und portable Übergabe

Lokale Korrektur (nicht in175/isolierter Ableitung gepusht): Quelle-Bézierkontakte
statt Rasterfehler,50+1 statt42+9 aninseln/233; finale Ableitungsausgabe validiert.
Kein gemeinsames Veröffentlichen des gemischten Hauptstands. Gemeinsamen
`src/contourTopology.ts` beim späteren PR-Split/Abhängigkeiten berücksichtigen.
[Stand, Tests, Build, Rechnerwechsel und Restpunkte](../handoff-islands-20261108.md).
PR176 ist Ready for review, nicht Draft. Ältere Abschnitte bleiben Nachweise
der damaligen Stände.

## Insel-Performance und reine Näherungsinformation — lokale Nacharbeit

Gemeinsame Such-/Kurven-/Fehlercaches und gemeinsame Vereinigung statt wiederholter
Vollberechnungen,120msToleranz-Debounce mit staleApply-/Close-Tests. Keine
Näherungs-Freigabemodals mehr auf Benutzerwunsch, Kennzeichnung/rote Vorschau
bleiben.44 Outline-/44 Dialog-/28 Modus-/20 Näherungschecks bestanden; lokale
Benchmark-Geometrie/-Ausgabe bytegleich, Vorbereitung~3,54->0,55s/Auswahl~0,9->0,027s.
Neuer kombinierter Build fertig:
`artifacts/windows-island-performance-20261108-210506/KizamuBeam-island-performance.exe`
mitNSIS;18Prüfbefehle/60Fallstudie/Geometrieoracle/Quellen-/Binärhashprüfung
bestanden. Vorgänger nach Prozesscheck nicht mehr laufend und bereinigt, kein
Prozess beendet/App gestartet. Keine Veröffentlichung/Lockerung der
Geometrieguards;170-Provenienz und vereinfachtes Insel-Kantenwerkzeug weiter offen.

## Insel-Direktwahl und Listenmarkierung — lokale Bedienkorrektur

Verfügbare Näherungen direkt wählbar mit Einzelfreigabe statt deaktivierter
Checkbox. Arbeitsflächenklick hebt zugehörige Listenzeile hervor und scrollt
sie sichtbar.22 Ressourcen-/40 Dialog-/28 Moduschecks,tsc/i18n bestanden.
Neuer kombinierter Build fertig:
`artifacts/windows-island-selection-20261108-193958/KizamuBeam-island-selection.exe`
mitNSIS;18Prüfbefehle/60Fallstudie/Quellen-/Binärhashprüfung bestanden. Laufenden
Vorgänger belassen, keine Prozesse beendet. Keine Veröffentlichung/Geometrieguard-
Lockerung; bisherige PR-Trennung und offene170-Provenienzprüfung bleiben.

## Individuell bestätigte Inselnäherung — lokale Nacharbeit

Optionaler geprüfter Linienzug für einzeln gewählte, nicht exakt ableitbare
Inseln. Freigabe/rote Vorschau/Bestätigung/Editor-Guard/Undo implementiert;
Alle-Auswahl bleibt exakt, keine pauschale Außenrand-/Nachbar-Näherung.
42 Outlinechecks/15 neue Ressourcen-UIchecks bestanden;39/28 bestehende
Dialog-/Originalmoduschecks weiterhin grün. Neuer kombinierter Build fertig:
`artifacts/windows-island-approximation-20261108-192425/KizamuBeam-island-approximation.exe`
mitNSIS;18Prüfbefehle/60Fallstudie/Quellen-/Binärhashprüfung bestanden.
Vorgänger erst nach Ende seiner Laufzeit/Prozesscheck bereinigt, kein Agenten-Kill.
Keine PR170-Änderung/Veröffentlichung, Provenienzprüfung und zweites Insel-
Kantenwerkzeug bleiben offen. [Details](../outline-islands.md).

## Aktuell: Außenkontur und Inseln, erste Stufe — 08.11.2026

Lokale Nacharbeit zu #170, NICHT veröffentlicht: drei Ausgabemodi mit
einheitlicher Inselbenennung, exakte Quellkurven-Rückführung, explizite
Toleranzanschlüsse statt veränderter Quellendsegmente, mehrdeutige Inseln gesperrt.
34 Geometrie-/Editor-,39 Browser-,28 Originaldatei-UIchecks und60 synthetische
Fälle bestanden. Bestehende Kontur-/Slotarbeit bleibt separat unveröffentlicht.
Lizenz-/Provenienzprüfung #170 weiter offen; vereinfachtes Insel-Kantenwerkzeug
noch geplant,114-Insel-Screenshotauswahl nicht identisch reproduziert.
[Details](../outline-islands.md). Neuer kombinierter Build fertig:
`artifacts/windows-outline-islands-20261108-142237/KizamuBeam-outline-islands.exe`
mitNSIS,18Prüfbefehle/60Fallstudie/Quellen-/Binärhashprüfung bestanden. Nur
neuestesWindowsarchiv behalten; vorherigesArchiv/gesperrterRest jetzt bereinigt.
Keine App/Installation/Hardware gestartet, keine Prozesse beendet.
Ältere „neuester“-Einträge unten sind historische Nachträge.

Neuester kombinierter Testbuild:
`artifacts/windows-offset-edit-target-20261108-124558/KizamuBeam-offset-edit-target.exe`.
Bearbeitungsziel unabhängig von Versatzfreigabe;18 Prüfbefehle/EXE/NSIS/
Quellenhashprüfung bestanden.46Dialog/33Offset/17Ressourcen/11Originalziel-
Checks bestanden. Nur dieser Windows-Build behalten; keine Konturveröffentlichung.
[Nachweis und Einschränkungen](../local-builds.md).

Aktuellster kombinierter Testbuild:
`artifacts/windows-section-safety-20261108-031631/KizamuBeam-section-safety.exe`.
Abschnittsauswahl/Ergebnisschutz,18 Prüfbefehle/EXE/NSIS/Quellenhashprüfung
bestanden. Alte Windows-Archive entfernt; [Nachweis](../local-builds.md),
[229 Studienfälle und Einschränkungen](../contour-offset-parameter-study.md).
Lokale Konturprototypen weiterhin unveröffentlicht, native Abnahme offen.

Neuester kombinierter Testbuild (keine Veröffentlichung der lokalen Prototypen):
`artifacts/windows-curve-exclusion-fix-20261108-013526/KizamuBeam-curve-exclusion-fix.exe`.
18 Prüfbefehle/EXE/NSIS/Quellenhashprüfung bestanden; vorheriger Build noch in
Verwendung und deshalb behalten. [Nachweis und Grenzen](../local-builds.md).

## Beauftragtes PR176-Update und Kurvennacharbeit — 08.11.2026

[#176](https://github.com/negurvulkan/kizamubeam/pull/176) aktualisiert auf
`9ff440b` (inzwischen Ready for review). Drei Pickerbefunde korrigiert und getrennt getestet:
38 neue +14 alte Browserchecks, vertrauenswürdiger Hold sowie relevante
PR-Tests/tsc/build/i18n bestanden. Lokale Hauptquelle übernimmt Pickerkorrekturen
unter Beibehaltung zusätzlicher Preview-Guards;38+14 Checks auch dort bestanden.
Keine Konturprototypen mitveröffentlicht, keine native macOS-Abnahme.

Lokale Ausschlussnacharbeit: begrenzte geordnete Übergänge von exakten Kurven;
27 Kontur-,11 Ausschluss-,10 neue Kurven- und27 Dialogchecks bestanden.
Originaldatei154–158:20 gekrümmte Stichproben exakt/geschlossen/wiederöffnbar,
7 enge Fälle weiter sicher abgewiesen. Exakte Screenshotpunkte bleiben ungeprüft.
[Details/Grenzen](../contour-offset.md), [PR-Nachweis](176-review-20261108.md).

## Aktueller Nachtrag — 08.11.2026

Neuer vollständiger Windows-Testbuild:
`artifacts/windows-contour-exclusions-20261108-005402/KizamuBeam-contour-exclusions.exe`.
18 Prüfbefehle/EXE/NSIS und Quellenhashprüfung bestanden. Alte EXE noch in
Verwendung/gesperrt, nicht automatisch beendet; [Buildnachweis](../local-builds.md).

Konturversatz bleibt lokal: Ausschlussbereiche mit exakten Originalkurven und
geraden Schnittverbindungen, vollständige Ergebnisvorschau, einzeln bestätigte
Reststückentfernung, echte Closure plus Layer-Kerf-Bestätigung implementiert.
27 Kontur- und11 Ausschlusstests,19 neue Dialogchecks,33 bestehende Offsetchecks,
14 Ressourcen-Editorchecks bestanden. Read-only Objekt187 bei Tol0,2/Inset0,1
und0,8 mit repräsentativem Ausschluss und gewählter Bereinigung ohne neue
Offen-/Unverbunden-Warnungen. [Grenzen/Details](../contour-offset.md).
Ältere Build-/Ergebnisfreigaben unten sind historisch; native Abnahme bleibt offen.

PR176 read-only geprüft, keine Änderungen/Veröffentlichung:
[drei offene Befunde und tatsächlich ausgeführte Checks](176-review-20261108.md).
KI-Unterstützung: GPT 6.1 Sol (OpenAI) via OpenCode.

Konturversatz-Nacharbeit mit `frame_test_2.kzb` bleibt **lokal/unveröffentlicht**:
eindeutige vollständige Randwege, keine künstlichen Eigentümernähte innerhalb
eines Blatts, gültige bisherige Vorschau bei abgelehnten Zusatzklicks erhalten.
41 statt31 akzeptierte Konturen bei dokumentierter Auswahl/Parametern;
Details/Grenzen: [Konturversatz](../contour-offset.md).
Neuer gemeinsamer Windows-Build **bestanden**:
`artifacts/windows-contour-offset-fix-20261107-215048/KizamuBeam-contour-offset-fix.exe`.
18 fokussierte Checks, Browserprüfungen und Quellen-ZIP-/Nachbuild-Hashes bestanden;
nur dieses Windows-Archiv behalten. Abschluss: [local-builds.md](../local-builds.md).
Die getrennten öffentlichen Draft-PRs bleiben unverändert.

## Neue Editor-Runde: vier getrennte Draft-PRs — 07.11.2026

**Integrationsnachtrag:** Alle vier inzwischen im kombinierten lokalen Quellstand
integriert. Neue und bestehende Browserprüfungen auf diesem Stand bestanden.
Windows-EXE/NSIS unter `artifacts/windows-editor-round-20261107-200133/`
**bestanden**, 18 Checks sowie Quellen-ZIP-/Nachbuild-Hashprüfung bestanden.
`KizamuBeam-editor-round.exe` enthält alle vier und alle bisherigen lokalen
Anpassungen. Alte Windows-Archive gelöscht; nur dieser aktuelle Build bleibt.
Abschluss und Quellenhashprüfung siehe [Buildstatus](../local-builds.md).
Die getrennten PRs/Branches bleiben unverändert Draft, kein Upstream-Merge.

| Scope | Öffentlicher Draft | Geprüft |
| --- | --- | --- |
| Pfadinseln mit Löchern | [#175](https://github.com/negurvulkan/kizamubeam/pull/175) | 8 Testgruppen + 8 Browserchecks; Welt-mm-Abstand, optional bestätigtes Schließen eigener Endpunktlücken, Vorschau/Undo |
| Überlappungsauswahl | [#176](https://github.com/negurvulkan/kizamubeam/pull/176) | 14 Browserchecks + echter Chromium-Rechts-Hold/Release/Linksklick; Standard langer Rechtsklick, Auslöser und Haltedauer gespeichert einstellbar |
| Freihand-Fortsetzung/Neuzeichnen | [#177](https://github.com/negurvulkan/kizamubeam/pull/177) | 5 Testgruppen + 6 Browserchecks; bestehende End-/Ankerknoten, unveränderte Restsegmente, Undo/Abbruch |
| Lasso/Mehrfach-Handle-Auswahl | [#178](https://github.com/negurvulkan/kizamubeam/pull/178) | 5 Testgruppen + 7 Browserchecks; Objekt- und Komponentenlasso, Mehrfachgriff-Ziehen/Nudgen/Löschen |

Alle vier unabhängig gegen `73e75cb`/2.8.0, committed/gepusht, ausdrücklich
**Draft**, nicht gemergt. Auf jedem Zweig `test:nodes`, `test:refit`,
`test:isolation`, `test:context-menu`, `test:paths`, `test:apps`, `test:history`,
`test:gcode`, `i18n:check` und `build` bestanden. Bestehende Build-/i18n-Warnungen
bleiben. Details/Grenzen in den jeweiligen PR-Dokumenten; native Abnahme offen.
Separate Worktrees `../kizamubeam-{path-islands,overlap-picker,freehand-redraw,component-selection}-pr/`.
Der ursprüngliche PR-only-Abschluss enthielt noch keine EXE; der anschließende
Integrations-/Paketierungsnachtrag oben ersetzt diesen damaligen Stand.
Keine Installation/Hardwareaktion.
Dateidrop wurde nachträglich vom Benutzer als getestet bestätigt.

Wichtige Draft-Grenzen: Pfadinsel-Klassifikation nutzt approximierte Konturen,
Output behält exakte Originalkurven; Berührung/Überlappung wird abgewiesen.
Freihand-Neuzeichnen zunächst zwischen vorhandenen Knoten, kein Umlauf über
Knoten 0. Objektlasso umschließt die vollständige Bounding Box. Mehrfachgriff-
Bewegung löst betroffene Glattbindungen bewusst, Einzelgriffverhalten bleibt.
Überlappungsliste respektiert normale Gruppen-/Isolation-/Sperrsemantik.

**Konsolidierter aktueller Bestand:** [Nur lokale Features, öffentliche PRs,
offene TODOs und Klärungspunkte](../local-status-20261107.md).
Build-/Bereinigungsstatus: [local-builds.md](../local-builds.md).
Aktueller vollständiger Testbuild: `artifacts/windows-combined-current-20261107-161859/`
(EXE/NSIS, 15 Checks, frische Browserprüfungen, Quellen-/Binärhashes bestanden).
Zwölf ältere Archive gelöscht; Rest des alten Toolbar-Archivs noch durch dessen
laufende EXE gesperrt. Kein automatisches Beenden wegen möglicher ungespeicherter Daten.
Frühere Buildpfade und die frühere Unveröffentlicht-Liste unten sind historisch;
sie belegen weder aktuelle Verfügbarkeit noch einen weiterhin privaten PR-Status.

Stand: 2026-11-07. Vier frühere Editor-PRs inzwischen **gemergt**, sieben weitere
PRs veröffentlicht (Zuordnung unten); der kombinierte
Prototyp-Arbeitsbaum und übrige Funktionsumfänge bleiben lokal/uncommittet.
Diese Übersicht und die aktuellen Funktionsdokumente haben bei Statusangaben
Vorrang vor älteren Entwürfen in diesem Ordner. Gemeinsame Testbuilds bedeuten
nicht, dass die Funktionen später in einem gemeinsamen PR eingereicht werden.

Aktueller Toolbar-Testbuild **bestanden**:
`artifacts/windows-vector-toolbar-20261107-144632/`,
`KizamuBeam-vector-toolbar.exe` plus NSIS. Eigene Symbole, sichtbare Standardknöpfe
und kompatible Toolbar-Ergänzung enthalten; Quellarchiv/-hashes und Binärhashes
geprüft. Nicht gestartet/installiert. Kein neuer Toolbar-PR.

Vorheriger gemeinsamer Windows-Testbuild **bestanden**:
`artifacts/windows-editor-followup-20261107-140712/`,
`KizamuBeam-editor-followup.exe` plus NSIS. Quellarchiv/-hashes und Binärhashes
geprüft; nicht gestartet/installiert. [Builddetails](../local-builds.md),
[manuelle Abnahme](../prototype-manual-checks.de.md).

| Getrennter PR-Kandidat | Stand / Belege |
| --- | --- |
| Außenkontur mit gewählten Löchern | Lokal implementiert: gemeinsame Liniennetze, einstellbare Verbindungstoleranz, kleines nichtmodales Werkzeugfenster, gestrichelte Arbeitsflächenvorschau, Lochwahl und transaktionales Anwenden. [Workflow, Grenzen und Tests](../outline-tool.md). Windows-Testbuild `artifacts/windows-outline-workspace-20261107-023218/`; native Benutzerabnahme läuft. |
| Parametrische Schlitze / Ausklinkungen | Lokal implementiert: Gruppen, Entwürfe, Konstruktion, Spiegel-Unterfeatures, lokale Burn-/Eckprofile, Referenzen und Vorschau-Navigation. [Aktueller Stand und Tests](../slot-features.md); [älterer PR-Entwurf](parametric-slot-projection.md), dessen Status noch konsolidiert werden muss. |
| Kamera-Overlay-Hauptschalter | Lokal implementiert und getestet; [PR-Entwurf](camera-overlay-toggle.md). |
| Kontextmenüs | [PR #164](https://github.com/negurvulkan/kizamubeam/pull/164) gemergt; Issue #144 dadurch automatisch geschlossen. Lokale zusätzliche Einträge für Isolation/Vereinfachen/Formerstellung gehen über diesen isolierten PR hinaus. |
| Layer-Listenaktualisierung / Fokus | Inzwischen upstream durch PR #156 (`b32895d`) behoben. Die vier unabhängigen PRs basieren darauf und verändern diesen Fix nicht. Kombinierter älterer Testbranch enthält seinen lokalen Fokusguard. |
| Objektübergreifende Knoten-/Segmentbearbeitung | [PR #162](https://github.com/negurvulkan/kizamubeam/pull/162) gemergt. 11 fokussierte und 6 Browserchecks; unabhängiger Branch, Build/i18n/Pfad/Ecken/History/G-code bestanden. |
| Temporäre Isolation | [PR #163](https://github.com/negurvulkan/kizamubeam/pull/163) gemergt. Unabhängiger Branch, Ausgabe-/Serialisierungs-/Interaktionstests, 7 Browserchecks und Build/i18n/History/G-code bestanden. |
| Pfadvereinfachung/Kurvenanpassung | [PR #165](https://github.com/negurvulkan/kizamubeam/pull/165) gemergt. Unabhängig ohne Bleistift; 9 Geometrie-, 3 Editor-, 5 Browserchecks und Build/i18n/Pfad/History/G-code bestanden. |
| Formerstellung / Bleistift | Weiter lokal, nicht Bestandteil der vier PRs. Bleistift-Pointerbesitz/Rückmeldung nachgeschärft; Benutzer bestätigt am 07.11. „Bleistift funktioniert jetzt so wie erwartet.“ Gemeldeter Ablauf damit manuell abgenommen, keine allgemeine Plattformfreigabe. |
| Lokaler nichtdestruktiver Konturversatz | V2 nutzt Außenkontur-Netzerkennung mit Teilspannenzuordnung und ursprünglicher Hierarchie. 22 fokussierte und 27 Browserchecks bestanden. [Workflow](../contour-offset.md), [PR-Entwurf](local-contour-offset.md). Alter Build `windows-contour-offset-20261107-030607` enthält nur V1. |
| Pinch-Zoom | Windows-Pinch gezielt aktiviert; gemeinsame Ctrl+wheel-Empfindlichkeit/Gesture-Fallback für beide Canvases. 5 fokussierte und echte Canvas-Browserchecks bestanden; native Touchpad-Abnahme offen. |
| Bild-/SVG-Dateidrop | Native Datei→DOM-Bridge mit DPI-/Kontextprüfung. 5 Bridge-Checks und Browser-Routing bestanden; Explorer-Abnahme offen. |
| Eingeklappter Objekte-Baum | Layer und Gruppen initial geschlossen, manuelle Zustände über Refresh erhalten; realer Panel-Browsertest bestanden. |
| Vektor-Toolbar/Symbole | Neuer lokaler Follow-up: eigene Icons für Bleistift, Vereinfachen, Formerstellung und Isolation/Verlassen; Knotenwerkzeug bleibt der bestehende Einstieg. Standardleiste ergänzt, v5→v6 ergänzt bestehende Belegungen ohne Reset. Bewusst entfernte v6-Knöpfe bleiben entfernt. 11 Apps-/Migrationschecks und 21 reale Toolbar-DOM-Checks bestanden. Noch kein PR. |

## Was „unveröffentlicht“ aktuell bedeutet

### Neue PR-Runde — 07.11., nach Toolbar-Testbuild

Alle sieben separat gegen upstream `73e75cb` (2.8.0) extrahiert; keine
Schlitz-/Konturversatz-/Formerstellungsimplementierung mitveröffentlicht.

| Scope | PR | Tatsächlich isoliert geprüft |
| --- | --- | --- |
| Bild-/SVG-Drag-and-drop | [#168](https://github.com/negurvulkan/kizamubeam/pull/168) | Bridge 5, Browser 5 inklusive SVG-Import/Undo; nativer Explorer-End-to-End-Test bleibt offen. |
| Bleistift | [#169](https://github.com/negurvulkan/kizamubeam/pull/169) | 5 Regressionen, 6 Trusted-Mouse-Browserchecks; Benutzerbestätigung dokumentiert. Eigener Icon-/Standardleisten-Eintrag enthalten. |
| Außenkontur mit wählbaren Löchern | [#170](https://github.com/negurvulkan/kizamubeam/pull/170) **Draft** | 24 Geometrie/Editor + 31 Browserchecks. Herkunft/Lizenz möglicher VectorCraft-Adaptionen vor Merge klären. Verweis in #147, automatische Schließung erst bei Merge. |
| Fehlende Vektor-Toolbar-Symbole/Belegung | [#171](https://github.com/negurvulkan/kizamubeam/pull/171) | 8 echte Toolbar-DOM-Checks plus Apps/Migrationen. Unabhängig: Vereinfachen/Isolation; Bleistift und Außenkontur bringen ihre eigenen Einträge, unveröffentlichte Formerstellung bleibt lokal. |
| Eingeklappter Objekte-Baum | [#172](https://github.com/negurvulkan/kizamubeam/pull/172) | 6 echte Panelchecks für Defaults, Refresh, neue Layer und manuelle Gruppenwahl. |
| Pinch-Zoom | [#173](https://github.com/negurvulkan/kizamubeam/pull/173) | 5 fokussierte + 4 echte Canvas-Browserchecks, Windows Cargo check offline/locked bestanden. Benutzer bestätigt „getestet, works“. Upstream-Arbeitsfläche verdrahtet; lokale Schlitzvorschau bleibt beim künftigen Schlitz-PR. |
| Kamera-Overlay-Toolbar-Symbol | [#174](https://github.com/negurvulkan/kizamubeam/pull/174) | Offline-Kamera-Gate + 8 echte Toolbarchecks. Symbol in Haupttoolbar, kein Menütextknopf; Ein/Aus und aria-pressed. #145 war bereits geschlossen und bleibt unverändert; PR dort kommentiert. |

Auf jedem isolierten Stand: `test:apps`, `test:history`, `test:gcode`,
`i18n:check` (0 fehlend) und `build` bestanden. Reproduktions-Fixtures und
Headless-Chromium-Runner sind enthalten. Keine App-/Hardware-Inbetriebnahme,
keine Versionsänderung durch den Agenten und kein Merge. Mehrere PRs bearbeiten
benachbarte Toolbar/UI-Zeilen; Konfliktauflösung und gemeinsame Migrationstests
gehören zur Integration.

Die folgenden früheren Bestandsangaben beziehen sich auf den damaligen
Toolbar-Testbuild vor dieser PR-Runde, nicht auf den neuen Veröffentlichungsstatus.

GitHub-Abgleich am 07.11.: #162/#163/#164/#165 sind gemergt, #144 geschlossen.
Das neueste offizielle Release ist weiterhin **v2.7.0 vom 05.11.**: Gemergt heißt
nicht automatisch, dass schon ein offizielles Installationspaket mit diesen
Funktionen veröffentlicht wurde.

Historischer Bestand vor PRs #168–#174 (aktueller Status siehe Link oben):

1. Bleistift/Freihand samt Pointer-/Rückmeldungsfix.
2. Interaktive Formerstellung / Shape Builder.
3. Außenkontur mit wählbaren Löchern und Arbeitsflächenvorschau (#147 ist nur ein Issue).
4. Lokaler Konturversatz V2, editierbar oder bestätigt dauerhaft, ohne Root-Wechsel.
5. Parametrische Schlitze/Ausklinkungen: Referenzen, endliche Projektionskanten,
   Gruppen/Entwürfe, Konstruktion, Spiegel-Abhängigkeiten, lokale Burn-/Eckprofile,
   Referenzerkennung, Preview-Sichtbarkeit, Zoom/Hand-Pan und Worker (#146 nur Issue).
6. Kamera-Overlay-Hauptschalter (#145 nur Issue).
7. Pinch-Zoom-Fixes auf beiden Canvases einschließlich Windows-WebView-Einstellung.
8. Native Bild-/SVG-Dateidrop-Bridge.
9. Eingeklappte Layer im Objekte-Baum als Standard.
10. Neue Vektor-Toolbar-Icons/-Standardbelegung/-Migration (im Toolbar-Testbuild vom 07.11.).
11. Zusätzliche kombinierte Kontextmenüeinträge für Isolation, Vereinfachen und Formerstellung.

Layerlisten-Fix #143 ist bereits upstream (#156), kein verbleibender lokaler PR-Kandidat.

## Anforderung: lokaler nichtdestruktiver Konturversatz

Besprochene Zielrichtung; anschließend ausdrücklich zur Umsetzung freigegeben.
„Root“ wurde als ursprüngliches Objekt bzw. Gruppe bestätigt, nicht bloß als
zugehörige Außenkontur. Der aktuelle Implementierungsumfang und seine engeren
Geometriegrenzen stehen im verlinkten Funktionsdokument:

- Eine geometrisch geschlossene Kontur wählen, die aus mehreren getrennten
  Objekten/Abschnitten bestehen darf. Schließung nur innerhalb einer sichtbaren,
  einstellbaren Toleranz; keine willkürliche Schließkante oder konvexe Hülle.
- Einzelne Öffnungen gezielt verkleinern oder vergrößern, etwa um die Stegbreite
  zwischen Loch und Außenkontur zu erhöhen. Ungewählte Konturen unverändert lassen.
- Lokaler geometrischer Abstand in mm, unabhängig vom Layer-Kerf: keine Änderung
  des Layerwerts. Die spätere Schnittfugenkompensation bleibt ein eigener Schritt;
  ihre Kombination mit dem lokalen Versatz muss sichtbar und getestet sein.
- Quelle und editierbares Versatzrezept erhalten. Vorschau, spätere Änderung,
  Entfernen/Zurücksetzen, Speichern/Laden und Undo gehören zum nichtdestruktiven
  Vertrag. Eine bloße Offset-Kopie mit erhaltenem Original reicht dafür nicht.
- Bei gleicher Außenkontur erhöht ein um 0,2 mm nach innen versetzter Lochrand
  den angrenzenden geometrischen Steg um 0,2 mm; eine beidseitig begrenzte
  Lochbreite sinkt dabei um 0,4 mm.
- Verschwindende Öffnungen, Überschneidungen, mehrdeutige oder veraltete Bezüge
  ausdrücklich melden; keine stille Neuzuordnung oder ungeprüfte Ausgabe.

Vor einem PR: Quelländerungen je Scope extrahieren, Abhängigkeiten nennen,
Regressionen auf dem isolierten Stand erneut ausführen und tatsächliche
Benutzer-/Hardwareabnahme von automatischen Tests unterscheiden.

Wesentliche KI-Unterstützung: **GPT 6.1 Sol (OpenAI) via OpenCode**.
