# Lokaler Bestand und offene Punkte — 07.11.2026

## Aktuell: Kurventopologie korrigiert — 08.11.2026

Pfadinseln prüft echte Bézierkurven statt gerasterte Sehnenkontakte:
inseln.kzb/233 jetzt50 gültige Inseln+1 erhaltener Selbstschnitt, alle51 Originale
und Undo exakt. Ableitung validiert Rückführung und fertige Kontursammlung;
photoframe117–124:91 gültige exakte Ausgaben,3 unsafe Rückführungen blockiert,
einzeln geprüfte Polygon-Näherung bleibt möglich.9 Topologie-/14 Pfadinsel-/46
Outline-Tests,60Präzisionsfälle,Originaldateien und15Browserchecks bestanden.
Neuer Paketlauf über `scripts/build-island-test.ps1`; Abschluss nur bei
verification.txt im Archiv. [Portable Übergabe/offene Punkte](handoff-islands-20261108.md).
Keine Veröffentlichung der lokalen Korrektur; PR175 weiter Draft,PR176 ready.
Die folgenden älteren Teststand-Zahlen sind historisch.

## Insel-Performance und Näherungsinfo ohne Modal — Testbuild fertig

Wiederverwendete Netzwerk-/Segmentcaches, gemeinsame Vereinigung und120ms
Toleranz-Debounce. Näherungskennzeichnung genügt auf Benutzerwunsch; keine
separaten Freigabemodals mehr. Ersetzen/Geometrieschutz bleiben unverändert.
44 Geometrie-/44 Dialog-/28 Modus-/20 Näherungschecks undtsc/i18n bestanden.
Lokaler156Kandidaten-Benchmark Vorbereitung3544->551ms,Auswahl~900->27ms;
bytegleiche Geometrie-/Ausgabehashes, keine native Garantie. Neuer Build:
`artifacts/windows-island-performance-20261108-210506/KizamuBeam-island-performance.exe`
mitNSIS;18Prüfbefehle,60Fallstudie,Geometrieoracle,Quellen-/Binärhashprüfung
bestanden. Beide Vorgänger nach Prozesscheck beendet/entsperrt und bereinigt,
nur letzterWindowsbuild. Keine Prozesse/App/Installation/Hardware durch Agenten gestartet/beendet.

## Insel-Direktwahl und Listenmarkierung — Testbuild fertig

Näherung-verfügbar-Einträge standardmäßig anklickbar, Freigabe direkt für die
betroffene Insel. Optional einzelne Rückfragen überspringen; Apply-Bestätigung
bleibt. Klick im Arbeitsbereich markiert/scrollt die entsprechende Listenzeile.
22 Ressourcen-/40 Dialog-/28 Moduschecks und TypeScript/i18n bestanden.
Keine Geometrieschutzprüfung gelockert. Neuer kombinierter Build:
`artifacts/windows-island-selection-20261108-193958/KizamuBeam-island-selection.exe`
mitNSIS;18Prüfbefehle,60Fallstudie,Quellen-ZIP/Nachbuild-/Binärhashprüfung bestanden.
Vorgänger läuft noch(PID27276), deshalb belassen. Keine Prozesse beendet,
keine App/Installation/Hardware durch Agenten gestartet.

## Optionale Inselnäherung — 08.11.2026, Testbuild fertig

Geprüfte geschlossene Linienzüge für einzeln freigegebene gesperrte Inseln;
rot markiert, Bestätigung mit Inselnummern, Alle-Auswahl weiterhin nur exakt.
42 Geometrie-/Editor-,15 Näherungs-UI-,39 Dialog-/28 Originalmoduschecks bestanden.
Selbstkontakt/offene Grenzen/ungeklärte Zusammenführungen bleiben gesperrt.
Beide Ressourcen unverändert,84-Insel-Screenshotauswahl nicht exakt reproduziert.
Neuer kombinierter Build:
`artifacts/windows-island-approximation-20261108-192425/KizamuBeam-island-approximation.exe`
mitNSIS;18Prüfbefehle,60Fallstudie,Quellen-ZIP/Nachbuild-/Binärhashprüfung bestanden.
Vorgänger während Laufzeit belassen; nach erneutem Prozesscheck beendet/entsperrt
und bereinigt. Nur neuestesWindowsarchiv. Keine Prozesse durch Agenten beendet,
keine Veröffentlichung/Hardware/App/Installation durch Agenten gestartet.

## Neuer Arbeitsweg: Inseln zuerst ableiten — 08.11.2026

ErsteStufe umgesetzt: NurAußenkontur/Außenkontur+Inseln/NurInseln; adaptive
Erkennung und originale Bézierintervalle als Ausgabe, markierte Verbindungen
statt verzogener Quellkanten.34 Geometrie-/Editor-,39 Browser-,28 Originaldatei-
UIchecks,60 synthetische Fälle sowie Frontendbuild/i18n bestanden.
Neuer kombinierter Windows-Testbuild fertig:
`artifacts/windows-outline-islands-20261108-142237/KizamuBeam-outline-islands.exe`
mitNSIS.18Prüfbefehle,60Fallstudie,Quellen-ZIP/Nachbuild-/Binärhashprüfung
bestanden. Voriges komplettesArchiv und alte gesperrte Restdatei jetzt entfernbar
und bereinigt; nur neuestesWindowsarchiv behalten. Keine Prozesse beendet,
keine App/Installation/Hardware gestartet.114-Insel-Screenshotauswahl noch
nicht identisch reproduziert; keine Behauptung perfekter Erkennung. Vereinfachte
Kantenwahl für den separaten Inselversatz ist die offene zweite Stufe.
Details/Grenzen: [outline-islands.md](outline-islands.md). Nichts veröffentlicht.

## Neuester kombinierter Testbuild — 08.11.2026, 13:46

`artifacts/windows-contour-assembly-20261108-134611/KizamuBeam-contour-assembly.exe`
mit NSIS fertig.18 Prüfbefehle,80 Konturtests,Quellen-ZIP/Nachbuild- und
Binärhashprüfung bestanden.57 Dialog-/44 Mixed-Source-/17 Batch-/7 neue
Quelle187-Applychecks bestanden. Gemeinsame Ausgabe mit explizitem Host und
Kerf-Restbestätigung enthalten; Quelle187/Kontur3/Teilpfad34 bei0,2/0,1
nach individueller Restbereinigung übernommen und Undo exakt. Kontur29 bei0,01
weiterhin wegen Verschachtelung mit30 gesperrt. Ältere Abschnitte historisch.
Vorgängerdateien bereinigt, Windows-gesperrte alte EXE/Verzeichnis belassen;
keine Prozesse beendet. Keine App/Installation/Hardware gestartet.
Hashdetails und Einschränkungen: [local-builds.md](local-builds.md).
KI: GPT6.1 Sol(OpenAI)/OpenCode. Keine Veröffentlichung der lokalen Konturarbeit.

## Aktuellster Testbuild: Bearbeitungsziel unabhängig von Freigabe

`artifacts/windows-offset-edit-target-20261108-124558/KizamuBeam-offset-edit-target.exe`
vollständig gebaut und gehasht,18 Prüfbefehle/EXE/NSIS/Quellenprüfung bestanden.
46 Dialog-,33 Offset-,17 Ressourcen- und11 Originaldatei-Zielchecks bestanden.
Ungültige Wünsche bleiben bearbeitbar; Quelleausschlüsse können den vollen
Versatz reparieren, müssen es aber nicht. Letzte gültige Vorschau nie stellvertretend
anwendbar; Guards unverändert. Vorgängerarchiv sicher entfernt, nur neuestes
Windows-Archiv behalten. Keine Anwendung/Installation/Maschine gestartet;
native Abnahme offen. [Nachweis](local-builds.md).

## Aktuellster Build: Abschnitte und Ergebnisschutz

`artifacts/windows-section-safety-20261108-031631/KizamuBeam-section-safety.exe`
fertig, EXE/NSIS,18 Prüfbefehle,67 Konturtests und Quellen-/Binärhashprüfung
bestanden.38 neueDialog/33 bisherigeOffset/16 Ressourcen/31 Außenkontur/
96 Slots/11 Inputchecks bestanden. Automatische Abschnittsauswahl mit Vorschau,
Mehrdeutigkeitswahl und Advanced-Endgrenzen; neue Offen-/Unverbunden-Probleme
oder ungeklärte Kerf-/Füllwirkung sperren, kleine/schmale Ergebnisse warnen mit
Bestätigung. Keine automatische Löschung, keine universelle3mm²-Regel.
229 Studienfälle/Diagnosen getrennt dokumentiert, keine Hardwarefreigabe.
Vorgängerarchive nach erfolgreicher Prüfung entfernt; nur letzter Windows-Build
behalten, keine laufende App beendet. [Buildnachweis](local-builds.md),
[Studie](contour-offset-parameter-study.md). Native Benutzerabnahme offen.

## Aktuellster Testbuild — Kurvennacharbeit, 08.11.2026

`artifacts/windows-curve-exclusion-fix-20261108-013526/KizamuBeam-curve-exclusion-fix.exe`
ist vollständig gebaut:18 Prüfbefehle, EXE/NSIS, Quellen-ZIP-/Nachbuild-/Binärhashes
bestanden. Enthält gezielte Kurvenübergangs- und Endpunktdialogkorrekturen sowie
Pickerfixes aus PR1769ff440b, alle bisherigen lokalen Features erhalten.
27+11+10 Konturtests und27 Ausschluss-Dialogchecks bestanden.20 ursprüngliche
Kurvenstichproben verifiziert,7 enge Fälle bleiben sicher abgewiesen; exakte
Screenshot-Endpunkte und native Abnahme offen. Vorige Exclusions-EXE läuft noch:
Archiv behalten, nicht automatisch beendet. [Nachweis](local-builds.md).

## PR176-Korrektur — 08.11.2026

Vom Benutzer beauftragtes Update veröffentlicht: `9ff440b` in bestehendem Draft
[#176](https://github.com/negurvulkan/kizamubeam/pull/176), alle drei zuvor
dokumentierten Pickerbefunde korrigiert.38 neue +14 bestehende Browserprüfungen,
vertrauenswürdiger Hold und relevante PR-Tests bestanden;38 Regressionen auch
auf kombinierter lokaler Hauptquelle (mit Outline-Preview-Guards) bestanden.
Noch keine native macOS/WKWebView-Abnahme und noch kein neuer kombinierter Build.
Separat: Benutzer kann im Konturversatz trotz richtigem Modus den zweiten
Ausschlusspunkt nicht setzen; Screenshot156/157/158, generischer Rezeptfehler.
Die vorige native EXE gilt für diesen Ablauf weiter nicht als abgenommen.

## Aktueller Nachtrag — 08.11.2026 (ersetzt ältere Ergebnisfreigaben)

Vollständiger Testbuild bestanden:
`artifacts/windows-contour-exclusions-20261108-005402/KizamuBeam-contour-exclusions.exe`.
18 Prüfbefehle, EXE/NSIS, Quellen-ZIP und Nachbuild-Hashes geprüft; neue
Dialog19/Offset33/Ressource14 sowie Außenkontur31/Slots96/Input11 bestanden.
Alte EXE noch gesperrt/in Verwendung; keine automatische Prozessbeendigung.
[Paketierungsnachweis](local-builds.md).

Lokaler Konturversatz: Quellintervall-Ausschlüsse mit exakten Originalkurven,
geraden Schnittübergängen, persistentem Rezept und Undo; vollständige
Ergebnisvorschau, einzeln bestätigte Reststückbereinigung und formale Closure
mit ausdrücklicher Bestätigung vorhandenen Layer-Kerfs. Details und Grenzen:
[contour-offset.md](contour-offset.md). Alte EXE enthält dies nicht.
Objekt187 allein/Toleranz0,2: repräsentativer Ausschluss + diagnostisch ausdrücklich
gewählte Bereinigung bei Inset0,1 und0,8 ohne Offen-/Unverbunden-Warnungen;
geschützte Reste bleiben. Kein automatisches Löschen, keine native Abnahme.

PR #176 am Remote-Commit `fdaa7a1` read-only geprüft: offen/Draft, keine Reviews
oder CI-Checks. Offene Befunde: macOS-Ctrl-Klick ausgeschlossen; Escape während
Hold kann Auswahl/Isolation verändern; unterdrücktes frühes Kontextmenü geht bei
kleiner Bewegung vorzeitig verloren. Temporäre Event-Mocks reproduzieren die
Kontrollflüsse; keine native Plattformprüfung. Keine PR-Änderung/Veröffentlichung.
Substanzielle KI-Unterstützung: GPT 6.1 Sol (OpenAI) via OpenCode.

Aktuelle lokale Nacharbeit: Konturversatz mit `frame_test_2.kzb`,
41 statt31 akzeptierte Konturen bei Auswahl154+187/Toleranz0,2/Inset0,2;
fehlerhafte zusätzliche Wahl löscht nicht mehr gültige Auswahl/Vorschau.
25 fokussierte und33 synthetische Browserchecks sowie Ressourcenprüfungen
bestanden. Fünf Sicherheitsablehnungen bleiben, native Abnahme noch offen.
Details: [contour-offset.md](contour-offset.md). Neue vollständige EXE:
`artifacts/windows-contour-offset-fix-20261107-215048/KizamuBeam-contour-offset-fix.exe`;
EXE/NSIS,18 Checks, Browser- und Quellenhashprüfung bestanden, älteren Build gelöscht.
Paketierung: [local-builds.md](local-builds.md).

## Nachtrag: vier neue öffentliche Draft-Implementierungen

Abnahmenachtrag: Benutzer bestätigt den langen Rechtsklick als funktionierend;
an den zunächst getesteten Stellen gab es keine Überlappungen. Kein bestätigter
Windows-Eingabefehler, keine Änderung der Auslöselogik. Die separate gemeldete
Pfadinseln-Abweisung ist damit nicht als behoben oder abgenommen erklärt.

Integrationsnachtrag: inzwischen auch im kombinierten lokalen Quellstand und
Windows-Testbuild `artifacts/windows-editor-round-20261107-200133/` enthalten.
EXE/NSIS, 18 Checks und Quellenhashprüfung bestanden. Nur dieser Windows-Build
behalten; ältere Archive gelöscht. Abschlussnachweis in [local-builds.md](local-builds.md).

- [#175 Pfadinseln](https://github.com/negurvulkan/kizamubeam/pull/175):
  Abstand in Welt-mm, Löcher erhalten, wahlweise unveränderte Geometrie oder
  eigenes bestätigtes Endpunkt-Lückenschließen mit Vorschau.
- [#176 Überlappungsauswahl](https://github.com/negurvulkan/kizamubeam/pull/176):
  langer Rechtsklick standardmäßig, Hover-Hervorhebung, explizite Auswahl;
  Rechts-/Links-Hold/aus und Dauer in Einstellungen wählbar.
- [#177 Freihand-Fortsetzung/Neuzeichnen](https://github.com/negurvulkan/kizamubeam/pull/177):
  Endpunktfortsetzung bzw. Ersatz zwischen vorhandenen Knoten eines Teilpfads.
- [#178 Lasso/Mehrfach-Handle-Auswahl](https://github.com/negurvulkan/kizamubeam/pull/178):
  Objekt-/Komponentenlasso, Mehrfachgriff-Auswahl und Bearbeitung.

PR176 wurde am08.11.2026 auf Benutzerwunsch per Subagent auf **Ready for review**
gestellt; Benutzerabnahme Windows/Linux, macOS ungetestet. Head9ff440b unverändert,
kein Merge/Release/Tag. [Nachweis](https://github.com/negurvulkan/kizamubeam/pull/176#issuecomment-6726945250).
Die übrigen PRs sind Draft, unabhängig implementiert/geprüft, noch nicht gemergt. Die entsprechenden „noch nicht implementiert“-
Einträge weiter unten beschreiben damit den vorherigen Stand; aktuell sind
Review, Integration, genannte Ausbaugrenzen und native Abnahme offen.
Tests/Dateipfade/Grenzen: [PR-Übersicht](pr-drafts/README.md).

Diese konsolidierte Übersicht hat bei Statusfragen Vorrang vor historischen
Build-/TODO-Abschnitten. „Öffentlich“ bedeutet hier: Implementierung als Branch/PR
veröffentlicht; ein öffentliches Feature-Issue allein veröffentlicht keinen Code.
Keine Zusicherung vollständiger Feature- oder Plattformabnahme.

## Nur lokal vorhandene Implementierungen

1. **Interaktive Formerstellung / Shape Builder:** geschlossene Teilflächen
   auswählen und kombinieren; bestätigte Behandlung parametrischer Originale,
   Vorschau und Undo. Grenzen: keine allgemeine Gruppen-/Offenpfad-/Gap-Erkennung
   und keine live abgeleitete Geometrie. Eigene Toolbar-Integration ebenfalls lokal.
2. **Lokaler Konturversatz V2:** einzelne erkannte Konturen geometrisch innen/außen
   versetzen, editierbares Rezept oder ausdrücklich bestätigtes dauerhaftes Backen.
   Gemeinsame Netzwerkerkennung mit Außenkontur; ursprüngliche Blattobjekte,
   Gruppen, IDs, Transformationen und unberührte Kurvenabschnitte bleiben erhalten.
   V1 kompatibel lesbar; mehrdeutige/geteilte Eigentümerschaft wird blockiert.
   Kein Ersatz für und keine Änderung des Layer-Kerf.
3. **Parametrische Schlitz-/Ausklinkungs-Suite:** ursprüngliche Quelle plus
   gespeicherte Rezepte, Breite/Tiefe/Spiel/Faktor; freie und ältere konturgeführte
   Varianten sowie aktuelles Platzieren auf endlichen geraden Kanten mit getrenntem
   Ursprung, Messziel und Richtung. Dazu:
   - Gruppen mit vererbten Maßen/Korrekturen, persistente mehrfache Entwürfe,
     Featurebaum, bestätigte Gruppenzuweisung und Reihenfolge;
   - gemeinsamer Referenz-/Abhängigkeitsgraph, referenzierte Schnittpunkte,
     unendliche Mittelpunkt-Senkrechten und parametrische Spiegel-Kinder;
   - virtuelle Rundungsecken, allgemeine Winkelschwelle, gültige letzte Vorschau
     bei ungültigen Änderungen und explizites Wiederherstellen;
   - lokale Burn-Korrektur und geometrische Eckfreistellungen, Worker-Vorschau,
     reine Vorschau-Sichtbarkeit, bestätigter transaktionaler Original-Reset;
   - Zoom/Fit/Hand-Pan und Pinch-Integration **der lokalen Schlitzvorschau**.
   Issue #146 ist öffentlich, diese Implementierung noch kein öffentlicher PR.
4. **Zusätzliche kombinierte Kontextmenüaktionen** für Isolation, Vereinfachen
   und Formerstellung, über den bereits gemergten allgemeinen Kontextmenü-PR hinaus.

Diese Scopes getrennt veröffentlichen; keine Schlitz-/Versatz-/Shape-Builder-
Prototypen beiläufig in fremde PRs übernehmen. Der kombinierte Arbeitsbaum ist
uncommittet auf `feat/vector-tools`, Baseline `480d5b1` / 2.7.0.

## Bereits öffentlich, aber noch nicht gemergt

GitHub-Abgleich am 07.11.: alle folgenden PRs OPEN.

| PR | Inhalt | Status |
| --- | --- | --- |
| [#168](https://github.com/negurvulkan/kizamubeam/pull/168) | Native Bild-/SVG-Dateidrop-Bridge | Offen |
| [#169](https://github.com/negurvulkan/kizamubeam/pull/169) | Bleistift, Pointerfix, Rückmeldung, Icon | Offen; gemeldeter Ablauf vom Benutzer bestätigt |
| [#170](https://github.com/negurvulkan/kizamubeam/pull/170) | Außenkontur mit wählbaren Löchern | **Draft: Herkunft/Lizenz klären** |
| [#171](https://github.com/negurvulkan/kizamubeam/pull/171) | Sichtbare Icons/Defaults für Vereinfachen und Isolation | Offen |
| [#172](https://github.com/negurvulkan/kizamubeam/pull/172) | Objekte-Baum zunächst eingeklappt | Offen |
| [#173](https://github.com/negurvulkan/kizamubeam/pull/173) | Pinch-Zoom der Upstream-Arbeitsfläche/Windows-Flag | Offen; Benutzer bestätigt „getestet, works“ |
| [#174](https://github.com/negurvulkan/kizamubeam/pull/174) | Kamera-Overlay als Haupttoolbar-Symbol | Offen; Issue #145 war bereits geschlossen |

Bereits gemergt: #162 Knoten, #163 Isolation, #164 Kontextmenüs, #165 Refitting.
Layerlistenfehler #143 wurde upstream mit #156 behandelt; #144 ist geschlossen.
Neueste offizielle Veröffentlichung: **v2.8.0**, 07.11.2026. Die unabhängigen
Folge-PRs basieren auf `73e75cb`/2.8.0; der kombinierte Teststand bleibt 2.7.0.
Keine Versionsanhebung oder Übernahme der gesamten 2.8.0-Baseline vorgenommen.

## Offene TODOs — aktuelle Anwendung

### Integration und Veröffentlichung

- VectorCraft-Herkunft möglicher Außenkontur-Adaptionen tatsächlich auditieren;
  nötige Copyright-/Lizenz-/NOTICE-Hinweise belegen und übernehmen. #170 bleibt
  bis dahin Draft; andere Sprache beweist keine unabhängige Reimplementierung.
- Öffentliche PRs nach Review integrieren; benachbarte UI-/Toolbaränderungen und
  Migrationsversionen gemeinsam prüfen, individuelle Toolbar-Anpassungen erhalten.
- Lokale Scopes separat extrahieren, Abhängigkeiten nennen und isoliert testen.
- Kombinierten Prototyp kontrolliert auf aktuelle Upstream-Baseline integrieren,
  ohne Prototypen, Datenformate oder Nutzeranpassungen zu verlieren.

### Noch nicht implementierte Editor-Erweiterungen

- **Pfadinseln trennen:** als Draft #175 implementiert; Review/native Abnahme
  und kontrollierte Integration bleiben offen.
- Teilabschnitts-Vereinfachung und separate Glättungssteuerung.
- Freihand-Endpunktfortsetzung/Teil-Neuzeichnen, Lasso und Mehrfach-Handle-Auswahl:
  Drafts #177/#178 implementiert; Review, Integration und native Abnahme offen.
- Optional deutlichere Warnung bei Kameraauflösung/Kalibrierung, ohne Reset.

### Verbleibende Prüfungen

- Dateidrop: vom Benutzer als getestet bestätigt (Nachtrag nach Buildbereinigung).
  Keine erneute offene Abnahme des gemeldeten Ablaufs; weitere Plattformen bleiben separat.
- Native Bedienabnahme der Schlitzgruppen/-entwürfe/-spiegel, Referenzwechsel,
  Hand-Pan, Konturversatz und Shape Builder sowie Speichern/Laden/Undo im Alltag.
- Materialpassung, lokale Burn-/Layer-Kerf-Wechselwirkung, schmale Reststege und
  Reliefgeometrie prüfen. Keine autonomen Maschinenversuche; gesonderte Freigabe
  und geeigneter Sicherheitsaufbau erforderlich.
- Tastatur, Fokus, Accessibility, DPI/Multimonitor, große Dokumente und geometrische
  Grenzfälle; macOS-Abnahme und Linux-Paketierung/-Abnahme (Linux durch Benutzer).
- Bestehenden unabhängigen Sprach-Assertionfehler in `test:joints` klären;
  die Gesamtsuite wird nicht als bestanden ausgegeben.

## Klärungs- und bewusste Begrenzungspunkte

- **Live-Quellparameter:** gespeicherte eingebettete Generator-/Skizzendefinition
  bleibt erhalten; Live-Bearbeitung/Regeneration der eingebetteten Quelle fehlt.
  Verhalten veralteter Referenzen vor Erweiterung verbindlich festlegen.
- **Schlitzumfang:** aktuell ein geschlossenes Vektorobjekt, endliche gerade
  Platzierungskanten; Baugruppen und allgemeine affine Platzierung sind kein
  implementierter Vertrag. Gewünschten Ausbau getrennt entscheiden.
- **Boxes.py-Stile:** implementiert sind geometrische Freistellungen, nicht exakte
  kontinuierliche/zurücklaufende loop-/backarc-Werkzeugbahnen. Ob solche Bahnen
  benötigt werden, ist ein eigener Umfangs-/Architekturentscheid.
- **Korrekturen:** lokaler Konturversatz ändert Geometrie unabhängig vom Layer-Kerf.
  Schlitzdialog blockiert gleichzeitigen lokalen Burn und Layer-Kerf beim Apply;
  spätere manuelle Layeränderungen bleiben eine Bedienverantwortung.
- **Kontureigentum:** geteilte/mehrdeutige Ränder bleiben erkannt, aber gesperrt;
  weder Sammel-Root noch stilles Umhängen auf andere Objekte.
- **Output-only-Korrektur „Layer ersetzen/addieren“:** historischer Vorschlag,
  nicht implementiert und nicht zur Umsetzung freigegeben. Nicht mit dem
  freigegebenen geometrischen Konturversatz verwechseln.

## Nicht erneut öffnen / historische Abgrenzung

Gemeldeter Bleistiftablauf und Pinch-Zoom sind benutzerbestätigt; Isolation war
ebenfalls bestätigt. Photoframe-Fragen wurden ausdrücklich abgeschlossen.
Die älteren Rust-/egui-/Workbench-/P0-/LightBurn-Paritätsblöcke der zentralen TODO
gehören zu anderen Entwicklungsständen/Anwendungen und sind nicht ungeprüft
fehlende Funktionen dieses Tauri-/TypeScript-Projekts.

Build-/Bereinigungsnachweis: [local-builds.md](local-builds.md). Keine App oder
Installation gestartet, keine Hardware verbunden. Wesentliche KI-Unterstützung:
**GPT 6.1 Sol (OpenAI) via OpenCode**; keine unabhängige menschliche Abnahme.
