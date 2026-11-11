# Komplettes kompaktes Entwicklungspaket

Dieses Paket ist privat: es enthält eigene Projektdateien und unveröffentlichte
Entwicklungsstände. Nicht als Ganzes auf GitHub hochladen.
KI-Unterstützung: GPT6.1 Sol (OpenAI) via OpenCode.

## Mitnehmen

Nur den **gesamten Buildordner**, der dieses Unterverzeichnis `weiterarbeiten`
enthält, kopieren. Der40GB-Ordner `laser_beam` wird nicht benötigt.
Die geprüfte EXE und ihre ursprünglichen Buildnachweise liegen eine Ebene höher.
`RESTORE-VERIFIED.json` belegt die tatsächlich geprüfte Wiederherstellung;
`INCOMPLETE` bedeutet, dass das Paket noch nicht fertig ist.

## Direkt lesen

- `WISSEN/laser_beam/TODO.md`: kanonischer Gesamt-Backlog.
- `WISSEN/kizamubeam/docs/handoff-islands-20261108.md`: aktuelle Inselkorrektur,
  Testergebnisse, Einschränkungen und offene Feature-/PR-Arbeit.
- `WISSEN/kizamubeam/docs/pr-drafts/README.md`: Funktions-/PR-Ledger.
- `WISSEN/laser_beam/docs/`: ursprüngliche Analysen, Entscheidungen und Audits.
- `manifest.json`: exakte Branches,HEADs,Staging-/Dateistände aller Worktrees.
- `checksums.json`: Integritätsprüfsummen der Paketdateien.

Enthalten sind die Git-Historie mit lokalen Branches/Tags/Remote-Refs und
abgetrennten Review-HEADs, alle unveröffentlichten getrackten und ungetrackten
Quell-/Dokumentänderungen (Staging getrennt erhalten), eigene Rust-Quellen,
Tools/Skills, Dokumentation/READMEs/TODOs, Analyse-/Testberichte und Screenshots,
sowie die vier privaten `.kzb`-Ressourcen. Historische USB-Quellkopien ohne Git
sind komprimiert unter `reference/` enthalten, nicht als aktive neue Projekte.

Ausgeschlossen: `node_modules`,Rust-`target`,Vite-`dist`,Graph-Indizes,Tool-Venvs,
alte EXEs/Debugsymbole,erneut erzeugbare Browserbundles und heruntergeladene alte
Fremdprogramm-Versionen. Authentifizierung und rechnergebundene Provider-/Maschinen-
Einstellungen werden nicht übertragen. `manifest.json` dokumentiert Ausschlüsse.
Die Originalquellen werden durch die Sicherung weder committet noch verworfen.

## Auf einem anderen Rechner wiederherstellen

Benötigt **Git und Python3.11+**. Anschließend für Entwicklung zusätzlich Node20+
und Rust/Tauri-Prerequisites. Kein Netzwerkzugriff für die Wiederherstellung.

```powershell
python RESTORE.py --destination "D:/Entwicklung/laser_beam"
```

Linux/macOS entsprechend `python3`. Das Ziel muss **neu/nicht vorhanden** sein;
vorhandene Dateien werden niemals überschrieben. Das Skript prüft zuerst die
Paket-Hashes, erzeugt Git-Worktrees mit neuen,korrekten Pfadverknüpfungen und
prüft HEADs,Staging-Bäume,Datei- und Ressourcenhashes. Keine App/Hardware startet.
ZIPs nicht händisch über vorhandene Arbeiten entpacken; `RESTORE.py` übernimmt
die Reihenfolge. Danach nur noch im wiederhergestellten Arbeitsverzeichnis arbeiten.

Die Struktur im Ziel:

```text
laser_beam/
  START-HERE.md, TODO.md, README.md, PLAN.md, ...
  .git-storage/kizamubeam.git/       gemeinsame, vollständige Git-Datenbank
  forks/kizamubeam-upstream/        sauberer aktueller Upstream, nur für Updates
  forks/kizamubeam-main/            kombinierter lokaler Test-/Entwicklungsstand
  forks/kizamubeam-*-pr/            getrennte PR-/Feature-Arbeitsbäume
  crates/, docs/, tools/, .opencode/ ursprüngliche eigene Quellen und Wissen
  resources/                       private Testprojekte
  artifacts/                       kompakte Berichte, keine alten Programme
  reference/                       historische Quellen nur als ZIP
```

## Künftig GitHub pullen und lokal weiterarbeiten

Der saubere Arbeitsbaum `forks/kizamubeam-upstream` verfolgt `upstream/main`:

```powershell
git -C "D:/Entwicklung/laser_beam/forks/kizamubeam-upstream" pull --ff-only
```

Das aktualisiert **nur Upstream**, nicht die lokalen Änderungen/PR-Arbeitsbäume.
Die Remotes sind normal eingerichtet:

- `upstream`: `https://github.com/negurvulkan/kizamubeam.git`
- `origin`: `https://github.com/liquid-light/kizamubeam.git`

GitHub-Anmeldung/SSH-Schlüssel bei Bedarf auf dem Zielrechner selbst einrichten.
`pull.ff=only` verhindert unbeabsichtigte automatische Merge-Commits beim Pull.
Die bisherigen Feature-Tracking-Zuordnungen bleiben erhalten; vor einem Pull
auf einem Featurebranch unbedingt `git status` und dessen Tracking prüfen.

Lokale Hauptarbeit:

```powershell
git -C "D:/Entwicklung/laser_beam/forks/kizamubeam-main" status
cd "D:/Entwicklung/laser_beam/forks/kizamubeam-main"
npm ci
npm run test:contour-topology
npm run test:path-islands
npm run test:outline
```

Später Upstream-Änderungen in einen lokalen Featurestand zu übernehmen ist ein
**separater bewusster Merge/Rebase**. Erst lokale Änderungen sichern/gezielt
committen und Konflikte prüfen. Es wurde dafür kein automatischer Merge,Reset,
Stash,Commit oder Push vorgenommen. Der gemischte Hauptstand ist weiterhin
**kein veröffentlichungsfähiger Gesamt-PR**; unabhängige Funktionen getrennt halten.

## Grenzen und nächste Arbeit

- Neuer Insel-Teststand:50 gültige Konturen+1 erhaltener Selbstschnitt aninseln/233;
  finale Ableitungsausgabe wird validiert,keine automatische Reparatur alter Dateien.
- Native Abnahme,weitere exakte Übergangsrekonstruktion,PR175-/Ableitungs-Split,
  italienische i18n,Stage2-Kantenwerkzeug und spätere interaktive Hilfe bleiben offen.
- #176 ist Ready for review; Benutzer meldet Windows/Linux erfolgreich,Mac ungetestet.
- Die wiederhergestellten Quellen sind der **aktuelle lokale Arbeitsstand**.
  `../build-sources.zip` bleibt unverändert der geprüfte Quell-Snapshot der EXE;
  spätere reine Übergabe-/Dokumentationsänderungen bauen die EXE nicht neu.
- Speicher wird erst wieder durch `npm ci`/Rust-Builds belegt. Diese Caches sind
  absichtlich nicht Teil des Transferpakets und können neu erzeugt werden.
