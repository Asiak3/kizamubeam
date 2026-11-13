# Weiterarbeiten: Insel-Geometrie und Windows-Teststand

Stand:08.11.2026. Diese Datei ist der Einstieg ohne Chatverlauf.
KI-Unterstützung: GPT6.1 Sol (OpenAI) via OpenCode.

## Verifizierter Abschluss

Build erfolgreich: `artifacts/windows-island-topology-20261108-225105/` mit
`KizamuBeam-island-topology.exe`,Installer,Quellen-ZIP und Übergabedokumenten.
19 fokussierte npm-Kommandos,60Fallstudie,beide privaten Regressionen,15
Trennfenster-Browserchecks,Outline-Browserchecks,Performance und Tauri bestanden.
Quellen-ZIP/Nachbuild-Hashes geprüft; keine Anwendung gestartet/installiert.
EXE SHA256: `5DEF4B33008939F4B11A2F88C98D82F5A9B629171BA37C534C6B3ADE02313FBF`.
Quellen-ZIP SHA256: `7F47C61F48591CFBBB65D9E5E12EEE4983C0CF6575275CCB56238D95E32AF6B0`.
Der ZIP hält den Quellen-/Doku-Snapshot vor dem Paketabschluss fest;
`verification.txt` und `BUILD-RESULT.md` dokumentieren den fertigen Paketlauf.

## Aktueller Stand

- Hauptarbeitsverzeichnis: `forks/kizamubeam-main`; gemischte, **nicht commitete**
  lokale Änderungen auf Basis480d5b1/2.7.0. Nicht komplett als PR veröffentlichen.
- Pfadinseln: verschiebbares nichtmodales Fenster, Listen-/Arbeitsflächen-Highlights,
  exakter Geometrieerhalt und Undo. Die frühere Rasterprüfung erzeugte Fehlalarme.
- Neu: `src/contourTopology.ts` prüft die tatsächlichen Bézierintervalle mittels
  monotoner Teilstücke und rekursiver Kontrollhüllen-Trennung. Fläche wird am
  Kurvenverlauf integriert. Keine Mindestflächen-/Mindestlängenlöschung.
- `src/pathIslands.ts` nutzt dies für Kontakte/Containment; das0.001mm-Raster
  bleibt nur für die bisherige Randabstands-Näherung. Pro Vorgang ein Cache,
  keine veralteten Geometrien über Vorschauänderungen/Apply hinweg.
- `inseln.kzb`, sichtbares Objekt233: **50 gültige Konturen +1 erhaltener
  selbstschneidender Teilpfad42**. Alle51 Teilpfade bleiben exakt erhalten.
  Objekt189/231 sind verborgen und enthalten echte Kontakte.
- `src/outline.ts` validiert rückgeführte Grenzen **vor dem Erfolgscache** und
  die fertige Kontursammlung nochmals **vor einer Dokumentänderung**. Eine
  selbstschneidende Rückführung wird nicht mehr als exakte Ausgabe angeboten.
  Individuell gewählte geprüfte Polygon-Näherung bleibt möglich/markiert.
  Keine stille Reparatur/Löschung alter Dateien oder automatische Näherung.
- `photoframe.kzb`, Objekte117–124, Toleranz0.05/0.2/0.3:162 Kandidaten,
  91 exakt ausgebbare Konturen;3 zusätzlich erkannte fehlerhafte Rückführungen
  werden als exakt blockiert, können einzeln als geprüfte Polygone gewählt werden.
- Performance: räumliche Vorauswahl bei Randabstand>0, transitive Gruppen nicht
  erneut vergleichen; vorberechnete Pick-Polygone/Bounds/Flächen. Der alte
  positive-Randabstand-Fall lief~0.5s bis Budgetfehler; neue Messungen mit der
  zusätzlichen Kurvenprüfung stehen im Buildarchiv. Nicht alte Speedups pauschal
  auf neue Genauigkeit übertragen; Nullabstand kostet jetzt mehr Prüfung.

## Verifikation und Windows-Build

Aktuell ausgeführt:9 Topologie-Testgruppen,14 Pfadinsel-Testgruppen plus
Originaldatei (inkl. Rotation/Spiegelung/Verschiebung, exakter Undo),46 Outline-
Tests,60 Präzisionsfälle, photoframe-Rückführungsregression und15 Ressourcen-
Browserchecks.
Aktuelle separate Chromium-Messung (7 Wiederholungen): Median Öffnen22.7ms,
300 Hoverproben1.4ms,10Renderdurchläufe15ms,Apply19.8ms; kein natives Versprechen.
Der nachfolgende
Paketlauf prüft den kombinierten Stand erneut und protokolliert Browser/Build.
**Nur ein Archiv mit `verification.txt` ist fertig verifiziert.** Ein Ordnername
oder diese Dokumentation allein ist kein erfolgreicher Buildnachweis.

```powershell
npm ci
npm run test:contour-topology
npm run test:path-islands
npm run test:outline
node scripts/vector-offline-test.mjs scripts/path-islands-test.ts "<resources>/inseln.kzb"
node scripts/vector-offline-test.mjs scripts/island-geometry-resource-test.ts "<resources>/photoframe.kzb"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-island-test.ps1 -ResourceDirectory "<resources>"
```

Benötigt Node20+, Rust/Tauri-Windows-Prerequisites, Chromium für isolierte
Browserfixtures (ggf. `BROWSER_BIN` setzen). Das Skript startet/installiert
**nicht** die Desktop-App, sondern baut EXE+NSIS und führt Headless-Fixtures aus.
`-SkipPrivateResources` ist möglich, protokolliert aber ausdrücklich den Verzicht
auf Ressourcen-/Ressourcenbrowser-Prüfungen. Linux/macOS: normale Tauri-Bauwege
aus `docs/development.md`; dieses Verpackungsskript ist Windows-spezifisch.

Manuell: Objekt233 wählen → Pfadinseln trennen → Randabstand0, Erhalt an.
Erwartet51 Ergebnisobjekte, nur1 roter erhaltener Teilpfad; Fenster bewegen,
Arbeitsfläche/Liste gegenseitig hervorheben, Apply und Undo prüfen. Neue
Ableitung: die großen bisher roten Konturen müssen gültig sein. Gesperrte
Rückführungen nur einzeln und bewusst als markierte Näherung wählen.

## Auf einen anderen Rechner mitnehmen

**Aktualisierung: kompaktes Komplettpaket.** Das Unterverzeichnis
`weiterarbeiten/` im neuesten Buildordner sichert zusätzlich Git-Historie,
sämtliche PR-Worktree-Zustände,eigene Rust-Quellen,gesammelte Dokumentation,
Analyseberichte und die privaten Ressourcen. Es ersetzt die frühere Empfehlung,
den gesamten40GB-Ordner oder die anderen Worktrees separat mitzukopieren.
Siehe `weiterarbeiten/README.md`; fertig erst mit `RESTORE-VERIFIED.json`.
`RESTORE.py` stellt einen sauberen pullbaren Upstream-Arbeitsbaum getrennt vom
lokalen Hauptstand und den PR-Arbeitsbäumen her,ohne Netzwerk/automatischen Merge.
Die folgenden Angaben zu `build-sources.zip` allein bleiben als ursprünglicher
Buildnachweis gültig; für die vollständige Weiterarbeit das neue Paket verwenden.

Den **gesamten neuesten verifizierten** Ordner `artifacts/windows-island-topology-*`
kopieren: `START-HERE.md`, `build-sources.zip`, `source-sha256.txt`,
`baseline.txt`, `branch.txt`, `tracked-changes.patch`, Prüflogs, EXE/Installer,
`binary-sha256.txt`, `verification.txt`, ggf. `TODO-local.md`.

`build-sources.zip` enthält den kombinierten Quellstand einschließlich lokaler
neuer Dateien, Skripte und Markdown-Dokumentation, aber **kein `.git`**, keine
`node_modules`, Rust-Buildcaches oder privaten Ressourcen. Für Git-Fortsetzung
in einem neuen Clone die Basis aus `baseline.txt` auschecken und **in diesem
frischen Arbeitsverzeichnis** den ZIP-Inhalt darüberlegen. Der ZIP ist der
vollständige ausgewählte Quellstand, der Patch dokumentiert nur getrackte Diffs;
Patch nicht zusätzlich auf bereits überlagerte Dateien anwenden. Bestehende
Änderungen niemals überschreiben/zurücksetzen. Danach `npm ci` und Tests.
Es wurden bisher keine Dateilöschungen für diese Korrektur vorgenommen.

Die Originale `resources/inseln.kzb` und `resources/photoframe.kzb` müssen separat
privat mitgenommen werden (nicht öffentlich committen); Hashes im Archiv.
Für den **gesamten bisherigen Entwicklungsstand** zusätzlich die anderen
Worktrees/Branches und das kanonische `laser_beam/TODO.md` sichern: der kombinierte
Build-ZIP ersetzt weder deren Git-Historie noch deren unpublizierte Änderungen.

## PR-/Worktree-Zuordnung (letzter bestätigter Stand)

- #170: gemergt (`7e580cae…`), Basis der Folgearbeit.
- #175 `feat/path-islands`, `forks/kizamubeam-path-islands-pr`: Draft,
  Head35998a9. **Neue lokale Trenn-/Geometrie-/Performance-Korrekturen noch nicht
  übertragen/gepusht.** Ein gemeinsamer Topologiehelfer benötigt eine saubere
  Aufteilung/PR-Abhängigkeit zur Ableitung, keine Vermischung mit Offset/Slots.
- Inselableitungs-Folge-PR: `forks/kizamubeam-island-extraction-pr`,
  `feat/island-extraction`, aktuelles Upstream2.8.0. Noch unveröffentlicht;
  neue Topologiekorrektur dort noch nicht enthalten. Build/43 damalige Tests
  bestanden; italienische Übersetzungen/i18n und Browserlauf noch offen.
- #176: **Ready for review**, Head9ff440b. Benutzerabnahme Windows/Linux,
  macOS ungetestet. Keine neue Releaseversion/Tags/Merge.
  https://github.com/negurvulkan/kizamubeam/pull/176#issuecomment-6726945250
- Weitere lokale Offset-/Slot-Prototypen und #177/#178 bleiben getrennt.
  Details: `docs/local-status-20261107.md`, `docs/slot-placement.md` (working drafts in `docs/pr-drafts/` removed).

## Offene Punkte / Grenzen

1. Native Benutzerabnahme des neuen Builds und beider Werkzeuge; keine
   Hardware-/Fertigungsfreigabe aus Simulator-/Browsertests ableiten.
2. Validierung verhindert nun fehlerhafte exakte Ausgabe, rekonstruiert aber
   nicht automatisch jeden problematischen Quellübergang neu. Für abgewiesene
   Grenzen gilt weiterhin explizite Polygon-Näherung oder Ablehnung. Weitere
   exakte Übergangsverbesserungen sind separat zu prüfen; keine Geometrie löschen.
3. Numerische Auflösung1e-10mm, begrenzte rekursive Arbeit. Nicht auflösbare
   Kontakte werden konservativ abgewiesen. Keine symbolisch-exakte oder universelle
   Topologie-/Herstellbarkeitsgarantie, besonders bei extremen Koordinaten.
4. Randabstände und Workspace-Picking verwenden weiterhin bestehende
   Polygon-Näherungen; nur die Kontakt-/Flächen-/Containmentprüfung wurde ersetzt.
5. Isolierte PRs aktualisieren, italienische Lokalisierung fertigstellen,
   Umfang/Abhängigkeiten prüfen; **nicht den gemischten Hauptstand pushen**.
6. Zweites vereinfachtes Insel-Kanten-/Versatzwerkzeug offen. Kontextuelle Hilfe
   (Fragezeichen im Kreis, stabile Themenanker) nur Backlog, nicht implementiert.
7. Exakte84/114-Insel-Screenshotauswahl, macOS und echte Maschinen ungetestet.
   Früherer unabhängiger `test:joints`-Fehler nicht als bestanden darstellen.

Historische Befunde in `docs/island-validation-findings.md` wurden durch die
aktuelle Kurvenprüfung ergänzt; alte Zahlen42+9 oder „nur zwei Fehlalarme“
beschreiben **nicht** diesen korrigierten Stand.
