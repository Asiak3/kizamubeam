# Außenkontur und Inseln ableiten — erste Stufe

## Aktuell: Performance und Näherung ohne Rückfrage

Die Kennzeichnung „Näherung verfügbar“, rote Vorschau und der gespeicherte Name
„mit Näherung“ genügen als Information. Zusätzliche Freigabeschalter und modale
Näherungsbestätigungen entfallen auf Benutzerwunsch. Destruktives Ersetzen der
Originale bleibt gesondert bestätigungspflichtig. Geometrievalidierung, individuelle
Näherungsauswahl und Schutz vor ungeklärten Mischgrenzen sind unverändert.

Ursachen der Trägheit: Netzwerk-Suchindex und Kurvensegmente wurden für jede
Grenze erneut aufgebaut; die wachsende Gesamtauswahl wurde Insel für Insel
vereinigt. Jetzt ein gemeinsamer Index/Segmentcache pro unverändertem Netzwerk,
negative Rückführungsresultate gecacht und eine gemeinsame Vereinigung aller
gewählten Regionen. Änderungen an Netzwerkkanten verwerfen die betroffenen
Such-/Fehlercaches. Keine gröbere Auflösung oder gelockerten Arbeitsbudgets.

Toleranzeingaben werden120ms gebündelt. Währenddessen ist Anwenden sofort
gesperrt und die alte Vorschau wird nicht als aktuelles Ergebnis angeboten.
Schließen des Dialogs verwirft ausstehende Neuberechnungen. Listenmarkierung
und Scrollzuordnung bleiben erhalten.

Lokaler Node-Benchmark (nicht native Bedienung, nicht identische84erAuswahl):

| Auswahl | Vorbereitung vorher/nachher | Gesamtauswahl vorher/nachher |
| --- | --- | --- |
| 5Quellen,44Kandidaten | 758/310ms | ca172–206/13–17ms |
| 8Quellen,156Kandidaten | 3544/551ms | ca839–987/27–28ms |

Vorbereitung umfasst weiterhin Netzaufbau/Flächenprüfung und bleibt synchron;
die UI ist dadurch noch nicht beliebig großer Geometrie gegenüber blockierfrei.
Erkannte Geometrie, Fehler-/Näherungsflags und Ausgabepfade haben in beiden
Vergleichsfällen bytegleiche SHA256-Hashes. Zusatztests prüfen gemeinsame vs.
bisherige schrittweise Vereinigung für alle Teilmengen mit Verschachtelungen.
Berichte: `artifacts/outline-islands/performance-before.json` und `performance-after.json`.

44 Geometrie-/Editor-,44 Dialog-,28 Modus- und20 Näherungs-/Auswahlchecks sowie
TypeScript/i18n bestanden. Neuer kombinierter Windows-Build fertig:
`artifacts/windows-island-performance-20261108-210506/KizamuBeam-island-performance.exe`
mitNSIS.18Prüfbefehle,60Fallstudie,Baseline-Geometrieoracle,Quellen-/Binärhashprüfung
bestanden. Vorgänger nach Prozesscheck nicht mehr laufend und bereinigt; kein
Prozess beendet, keine App/Installation/Hardware durch Agenten gestartet.
Die folgenden Freigaberückfragen-/Schalteranweisungen sind historische Stände.
KI GPT6.1Sol(OpenAI) via OpenCode; keine Veröffentlichung/Hardwareaktion.

## Aktuelle Bedienung: Direktwahl und Listenmarkierung

„Näherung verfügbar · Linienzug“ ist jetzt **direkt anklickbar**, ohne vorher
einen versteckten Freigabeschalter zu aktivieren. Beim Anhaken oder Klick auf
die Arbeitsfläche wird die Erlaubnis für genau diese Insel abgefragt. Ablehnen
lässt sie ungewählt. Optional überspringt „Näherungen ohne einzelne Rückfrage
auswählen“ diese einzelne Nachfrage; die endgültige Apply-Bestätigung bleibt.
„Alle Inseln wählen“ nimmt unverändert nur exakt ableitbare Inseln hinzu.

Ein Klick auf eine Insel markiert ihren Listeneintrag (Rahmen/Hintergrund,
`aria-current`) und scrollt ihn sichtbar. Die Markierung zeigt das zuletzt
angeklickte Ziel unabhängig davon, ob es gerade gewählt oder abgewählt wurde.
Toleranzwechsel verwirft Auswahl/Freigaben/Markierung. Ungültige Grenzen bleiben
gesperrt. Geometrieprüfung und Näherungsalgorithmus wurden dabei nicht gelockert.

Nachweise:22 Ressourcenchecks inkl. direkter Checkbox-/Arbeitsflächenwahl,
Listenscrollen, Ablehnung/Rücknahme, endgültiger Bestätigung, Apply/Undo;
40 Dialog-/28 Originalmoduschecks sowie TypeScript/i18n bestanden.
Neuer kombinierter Windows-Build fertig:
`artifacts/windows-island-selection-20261108-193958/KizamuBeam-island-selection.exe`
mitNSIS;18Prüfbefehle,60Fallstudie,Quellen-/Binärhashprüfung bestanden. Vorgänger
weiter laufend und deshalb belassen, kein Prozess beendet. Die folgenden Buildeinträge
und Schalteranweisungen sind historische Stände vor der Direktwahl.

KI-Unterstützung: GPT6.1Sol (OpenAI) via OpenCode. Keine Veröffentlichung.

## Neue optionale Näherung — Testbuild fertig

`artifacts/windows-island-approximation-20261108-192425/KizamuBeam-island-approximation.exe`
mitNSIS fertig;18 Prüfbefehle,60Fallstudie,Quellen-ZIP/Nachbuild-/Binärhashprüfung
bestanden. Nicht durch den Agenten gestartet oder installiert.

**Geprüfte Näherungen zur Einzelauswahl freigeben** aktivieren. Nur dann lassen
sich entsprechend gekennzeichnete, zuvor gesperrte Inseln einzeln auswählen.
„Alle Inseln wählen“ nimmt weiterhin nur exakt ableitbare Kandidaten hinzu.
Gewählte Näherungen sind rot markiert und müssen vor Apply mit ihren Nummern
ausdrücklich bestätigt werden. Rücknahme der Freigabe entfernt diese Auswahl;
auch der Editor selbst erzwingt die Bestätigung vor Dokumentänderung.

Ausgabe ist der erkannte geschlossene Linienzug, ohne Glättung/Interpolation,
zusätzliche Lückenschließung oder automatische Toleranzerhöhung. Die exakte
Quellkurvenzuordnung dieser Grenze geht verloren. Eine allgemeine maximale
Abweichung zur Originalkurve wird dafür **nicht** zugesichert. Originale bleiben
standardmäßig erhalten. Der neue Objektname enthält „mit Näherung“; normale
Pfadgeometrie/Name überstehen Speichern und Laden ohne neues Dateiformat.

Offene, selbstschneidende, berührende, rücklaufende oder entartete Polygone
sowie überschrittene Arbeitsbudgets bleiben gesperrt. Eine freigegebene Insel
berechtigt nicht zur Näherung einer anderen Grenze oder des Außenrands.
Verschmilzt ihre Grenze mit einer anderen gewählten Insel und ist dann nicht
mehr genau diese freigegebene Grenze, bleibt diese Kombination gesperrt;
gegebenenfalls getrennt ableiten. Keine doppelte Ausgabe gemeinsamer Kanten.

Nachweise:42 Geometrie-/Editorchecks,15 neue Originaldatei-Browserchecks inkl.
Freigaberücknahme/Bestätigung/Apply/Undo,39 bisherige Dialogchecks und28
Originaldatei-Moduschecks. Bei0,3 ist Insel22 der Originaldatei separat ableitbar;
bei der zweiten Datei Insel25/40. Beide Dateien unverändert. Die84-Insel-
Auswahl des neuesten Screenshots wurde noch nicht identisch reproduziert;
die zwei roten konkreten Inseln sind deshalb nicht abschließend zertifiziert.
Voriger Build unten ist historisch und wurde nach erfolgreicher Prüfung und
erneutem Prozesscheck als nicht mehr laufender Vorgänger bereinigt.
Keine Prozesse durch den Agenten beendet. KI: GPT6.1Sol(OpenAI) via OpenCode.

## Historischer Stand: erste Insel-Version ohne Näherungsfreigabe

Kombinierter Windows-Testbuild:
`artifacts/windows-outline-islands-20261108-142237/KizamuBeam-outline-islands.exe`.
EXE/NSIS,18 Prüfbefehle,60Fallstudie sowie Quellen-/Binärhashprüfung bestanden.
[Buildnachweis](local-builds.md). Nicht gestartet oder installiert.

Lokale Weiterentwicklung, nicht mit Draft #170 veröffentlicht. Wesentliche
KI-Unterstützung: GPT 6.1 Sol (OpenAI) via OpenCode. Herkunfts-/Lizenzprüfung
von #170 bleibt unabhängig davon offen; keine Behauptung unabhängiger Herkunft.

## Bedienung

Quellen auswählen → **Außenkontur und Inseln ableiten …**. Drei Ausgabemodi:

- **Nur Außenkontur** (Standard): Innenkonturen werden nicht ausgegeben.
- **Außenkontur + Inseln**: Außenkontur mit ausgewählten Innenkonturen.
- **Nur Inseln**: ausschließlich ausgewählte Innenkonturen, ohne Außenrand.

„Inseln“ bezeichnet hier die erkannten geschlossenen Innenbereiche, nicht die
Gruppierungsfunktion „Pfadinseln“. Verschachtelte Inseln bleiben getrennt
wählbar. Moduswechsel behält die Auswahl; Toleranzwechsel setzt sie zurück.
Ohne ausgewählte Insel ist „Nur Inseln“ nicht anwendbar. Originale bleiben
standardmäßig unverändert erhalten; Ersetzen braucht weiterhin Bestätigung.
Ableitung/Undo sind ein Schritt. Keine Dateiformat- oder Rezeptmigration.

## Geometrie und Grenzen

Erkennung erfolgt separat von der Ausgabe: adaptive Kurvenzerlegung mit
0,001 mm Kontrollpolygon-Abstand und höchstens 1 mm Sehnenlänge auf dem
vorhandenen 0,001-mm-Raster. Dies ist unabhängig von der Verbindungstoleranz
und **kein Beweis exakter Topologie unterhalb der Rasterauflösung**.

Ausgabekurven werden aus den ursprünglichen Bézierintervallen rekonstruiert,
nicht an Erkennungspolygone neu angepasst. Schnittparameter werden auf den
Quellkurven nachgeführt. Auch vom Raster verschluckte kurze echte Quellspannen
werden zurückgeführt statt entfernt. Keine pauschale Mindestflächenlöschung.

Toleranzanschlüsse sind eigene gerade Verbindungen statt verschobener
Quellendsegmente. Orange zeigt mögliche Verbindungen im Erkennungsnetz;
nur die auf ausgewählten Grenzen liegenden Verbindungen werden ausgegeben.
Auch rasterbedingt eng verfehlte Übergänge (höchstens 0,003 mm) dürfen nur
innerhalb der gewählten Toleranz als ausdrücklich markierte Verbindung dienen.
Eine synthetische Verbindung kann beim Rückführen von Raster- zu Quellpunkten
um höchstens 0,002 mm länger als die Raster-Toleranz sein. Diese numerische
Grenze ist keine automatische Erhöhung der Benutzertoleranz oder Freigabe
beliebiger größerer Lücken. Verbindungen sind tatsächliche Schnittlinien.

Gleich nahe unterschiedliche Anschlussziele werden nicht automatisch gewählt.
Uneindeutige Inselgrenzen bleiben sichtbar gesperrt; andere eindeutige Inseln
sind weiter auswählbar. Bei uneindeutiger Außenkontur kann „Nur Inseln“ weiterhin
benutzbar sein. Keine Rückfallausgabe einer groben Ersatzkontur.

## Nachweise und offener zweiter Schritt

- 34 Geometrie-/Editorchecks, darunter drei Modi, exakte Kurven, kleine Inseln,
  kurze Quellkanten, Spiegelung, mehrdeutige Anschlüsse und Undo.
- 60 synthetische Studienfälle: fünf Toleranzen × vier Lücken × drei Varianten;
  jeder Fall prüft alle drei Modi und unveränderte Quellen.
- 39 synthetische Browserchecks und 28 Originaldatei-Browserchecks inkl. Apply/Undo
  und sichtbar gesperrter uneindeutiger Insel bei gleichzeitig nutzbaren anderen Inseln.
- `frame_test.kzb`, Auswahl154–158, Toleranz0,05: ein Außenrand und 34 Inseln,
  alle drei Modi im Browser übernommen. Bei0,2:44 Kandidaten, einer gesperrt.
- Beide privaten Ressourcen bei fünf Toleranzen ausschließlich gelesen;
  Reports unter `artifacts/outline-islands/`, SHA256 unverändert.

Die 114-Insel-Auswahl aus dem Screenshot ist mit dieser Quellauswahl nicht
identisch reproduziert. Die markierten Stellen sind daher noch **nicht** als
vollständig behoben oder native Benutzerabnahme bestätigt.

Nächster Schritt: gezielte Kanten-/Abschnittsauswahl auf den abgeleiteten
geschlossenen Inseln. Der bestehende Konturversatz bleibt erhalten; die neue
Pipeline ändert seine alten Rezepte/Erkennung nicht. Eine Editorregression
prüft bereits Ableiten → separater Versatz mit ausgeschlossener Kante → Undo,
aber die vereinfachte Insel-Kantenbedienung ist noch nicht implementiert.
Keine physische Ausgabe, Maschinenverbindung oder native App gestartet.
