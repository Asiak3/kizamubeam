# Lokaler Konturversatz — lokaler Prototyp

## Gemeinsames geschlossenes Ergebnis — lokaler Testbuild

Paketiert in `artifacts/windows-contour-assembly-20261108-134611/`;
Build-/Hashnachweise siehe [local-builds.md](local-builds.md).

Für Konturen über mehrere Quellobjekte ausdrücklich ein beteiligtes Ausgabeobjekt
wählen und „Gemeinsames geschlossenes Ergebnis verwenden“ aktivieren. Dieses
Objekt liefert Layer, Kerf, Füll- und Unterlayer-Einstellungen. Genau ein Ring
wird dort ausgegeben; verbrauchte Quellabschnitte werden nicht zusätzlich
geschnitten. Originaldefinitionen, IDs, Gruppen und Transformationen bleiben
im editierbaren Rezept erhalten; Undo stellt sie wieder her. Kein Objekt-Merge.

Bestätigung zeigt die Einstellungen jedes gewählten Ausgabeobjekts. Abweichende
Laser-/Ausgabefreigaben bleiben gesperrt. Exakte verbleibende Quellkomplemente
dürfen nur bei LINE-Ausgabe mit ausdrücklicher Bestätigung offen bleiben:
darauf wirkt kein geschlossener Layer-Kerf mehr. Füllreste, veränderte Herkunft
oder neue Offen-/Unverbunden-Befunde bleiben gesperrt. Restlöschung weiterhin
nur einzeln nach Vorschau und Bestätigung, niemals für geschützte Abschnitte.

Originaldatei `frame_test.kzb`, Auswahl154–158: Kontur13/Teilpfad7 und
Kontur14/Teilpfad6 von157 bei innen0,5/Toleranz0,2 bestehen mit Host156 oder157.
Kontur13 benötigt keine Restlöschung;14 einzeln eine;13+14 zusammen zwei.
Nachweise:80 fokussierte Tests,10 optionale Originaldatei-Assemblytests,
44 Originaldatei-UIchecks,57 synthetische Dialogchecks und12 Mixed-Source-Fälle.
Keine native Anwendung, kein Installer und keine Hardware gestartet.

## Weitere Screenshots: Quelle187

`scripts/contour-offset-single-source-screenshot-study.ts` liest ausschließlich
`frame_test_2.kzb`. Kontur4, Teilpfad34, Toleranz0,2: innen0,1/0,2/0,5 bestehen
nach diagnostischer expliziter Restwahl; ausgeschlossene Béziersegmente bleiben
exakt erhalten und Wiederöffnen liefert identische Ergebnisse. Die Quellkurven
werden nicht durch gerade Näherungen ersetzt. Übergänge an Unterpfadknoten
eines einzelnen Besitzers verwenden nun dieselbe exakte Tangentenkonstruktion
wie gemeinsame Ergebnisringe; alle Kontakt-/Topologieprüfungen bleiben aktiv.

Kontur29, Teilpfad40, Toleranz0,01: Verbindung wird jetzt berechnet, aber die
Verschachtelungsprüfung mit Kontur30 verweigert innen0,1/0,2/0,5 weiterhin.
Dieser Nachweis gilt für die isolierte Konturwahl; die vollständige Auswahl im
ersten Screenshot ist nicht sichtbar und noch nicht exakt reproduziert.
Keine automatische Toleranzerhöhung, keine Aufhebung der Verschachtelungssperre.
Bericht: `artifacts/contour-offset-diagnostic/single-source-screenshot-study.json`.
Aktueller Nachlauf:80 fokussierte Tests und TypeScript bestanden.
Zusätzlich Toleranz0,1/Kontur3/Teilpfad34 bei innen0,2:7 Browserchecks mit
gezielter einzelner Restbereinigung, erfolgreichem Apply, gespeichertem
Ausschluss und exaktem Undo bestanden. Das ist nicht die Freigabe einer bloßen
letzten gültigen Vorschau; erst die bereinigte aktuelle Ausgabe besteht den Guard.

Substantielle KI-Unterstützung: GPT 6.1 Sol (OpenAI) über OpenCode.

## Bearbeitungsziel unabhängig von Freigabe — umgesetzt

Ungültige Versatzwünsche bleiben jetzt sichtbar angefordert; der zuletzt
angeklickte Kandidat ist das Bearbeitungsziel und bleibt in der Zielauswahl.
Alle eindeutig zugeordneten erkannten Konturen sind zur Quellabschnittswahl
zugänglich, nicht nur bereits gültige Versätze. Ausschlüsse werden im Entwurf
gespeichert und die gesamte Anforderung danach erneut geprüft. Mehrdeutige
Quellzuordnung wird weiterhin nicht umgangen.

Letzte gültige türkisfarbene Vorschau bleibt bei Fehlern erhalten und wird über
einen eigenen Status ausdrücklich als nicht aktuelles Ergebnis bezeichnet.
Anwenden ist dann gesperrt. Rot zeigt angeforderte Originalausschlüsse. Auch
ungültige Ausschlüsse können entfernt werden; Checkboxen bilden Anforderungen
ab, nicht eine heimlich andere akzeptierte Teilmenge. Reststücke bleiben für
ein berechenbares, aber sicherheitsgesperrtes Ergebnis bearbeitbar; bei nicht
berechenbarer Geometrie werden alte Reststücklisten gesperrt.

Browsernachweis:46 Dialogchecks inklusive Kollisionsrand-Reparatur (voller
Außenversatz ungültig, ausgeschlossene rechte Originalkante ergibt gültigen
Versatz, Apply/Undo korrekt),33 bestehende Offsetchecks,17 Ressourcenchecks
mit expliziter Restbereinigung und11 Originaldatei-Zielchecks. Letztere belegen
Bearbeitbarkeit der abgelehnten37/44 bei0,5, nicht deren beliebige Reparierbarkeit.
Keine Backend-Schutzprüfung abgeschaltet, keine Quelle/Layerdaten geändert.

## Laufende Nacharbeit: Bearbeitungsziel von Freigabe trennen

Benutzerfall: voller Versatz0,5 wird abgewiesen, dadurch bisher auch keine
Ausschlusswahl an der betreffenden Originalkontur möglich. Ursache war die
Filterung der Zielkonturen auf bereits angenommene Versatzwünsche.
Beauftragte Änderung: ungültigen Wunsch sichtbar vormerken, angeklickte Kontur
als Bearbeitungsziel festhalten und ihre Originalabschnitte trotzdem zugänglich
machen. Jede Ausschlussänderung prüft den vollständigen Wunsch erneut. Eine
letzte gültige Vorschau darf erhalten bleiben, aber niemals anstelle des noch
ungültigen aktuellen Wunsches angewendet werden. Bestehende Guards bleiben.
Test ergänzt für einen Außenversatz, der mit ausgeschlossenem Kollisionsrand
wieder gültig wird, plus sichere Bearbeitbarkeit ursprünglich abgewiesener
Originaldatei-Konturen37/44 bei0,5. Ergebnis dieser Tests erst nach Ausführung
als bestanden ausgeben; kein Beleg, dass jeder Screenshot-Rand reparierbar ist.

## Abschnittsauswahl und Ergebnis-Schutz — aktueller Implementierungsstand

Automatische Abschnittsauswahl implementiert: erst Konturen wählen, dann
„Abschnitte per Klick ausschließen“. Hover zeigt den vollständigen Quellabschnitt
zwischen Schnitt-/T-/gemeinsamen Anschlüssen, Einzelklick schaltet um. Keine
Grenze an gewöhnlichen Bézierknoten; Mehrdeutigkeit über Abschnittsliste wählen,
toleranzbedingte Anschlüsse markiert. Ohne Abzweigung nimmt der Klick den ganzen
gewählten Versatz zurück. Erweiterter Modus behält zwei freie Grenzen, explizite
Bogenwahl und Vorschau/Bestätigung. Originale, Rezepte und Undo bleiben erhalten.

Ergebnisprüfung jetzt in Dialog UND Editor vor Dokumentänderung: neue Offen-/
Unverbunden-Befunde und objektübergreifende ungeklärte Kerf-/Füllwirkung sperren
Anwenden. Bewusst erhaltene Teile werden nicht automatisch gelöscht. Einfache
objektübergreifende Linienkonturen ohne neue Befunde bleiben möglich, nicht aber
deren ungeklärte Kerf-/Füllausgabe. Vollständige Ergebnisvorschau bleibt sichtbar,
auch bei Sperre; nach abgelehntem Zusatzklick bleibt die Sperre im Text erklärt.

Kleine geschlossene Ergebnisfläche bis3mm² oder geringe Bounding-Box-Ausdehnung
(`max(0,01mm,2×|Kerf|)`) warnt und verlangt ausdrückliche Fertigungsbestätigung.
Keine universelle3mm²-Grenze, kein automatisches Entfernen. Ausdehnung ist keine
Messung der engsten lokalen Stegbreite. Bestehende Originaldateien werden nicht
automatisch repariert oder umgedeutet. Studie und Einschränkungen:
[Parameterstudie](contour-offset-parameter-study.md).

67 fokussierte Kontur-/Geometrie-/Abschnitt-/Schutztests,38 Dialogchecks,
33 bisherige Offset- und16 Ressourcen-UI-Checks bestanden. Kein physischer
Schneidnachweis. Aktueller Windows-Paketierungsstand in `local-builds.md`.

## Konzeptphase: Abschnittsauswahl statt Endpunkt-Raten

Aktueller Benutzerauftrag ist ein allgemeines, einsteigerfreundliches und sicher
ablehnendes Bedienkonzept. Vorschlag: Kontur wählen, sinnvolle Randabschnitte vor
dem Klick hervorheben und einzeln ausschließen; Mehrdeutigkeiten explizit wählen,
freie Endgrenzen und alternative geschlossene Umläufe als erweiterte Bearbeitung.
Kein weiterer Build auf Grundlage bloßer Sonderfallpatches.

**Arbeitsbaumwarnung:** Selection/Dialog enthalten pausierte, unvollständige
Subagent-Teiländerungen (konturgebundene Zweipunktauswahl, Snaps, Liveintervall und
Bogenwechsel). Nur TypeScript geprüft; Übersetzungen und Regressionen fehlen.
Dies ist noch keine Umsetzung des empfohlenen Abschnittskonzepts und darf nicht
als geprüfter Fix paketiert werden. Letzter Windows-Build enthält dies nicht.

## Exakte Screenshot-Reproduktion / Auswahlproblem — 08.11.2026

**Korrektur der bisherigen Dateiabweichungsannahme:** dieselbe `frame_test.kzb`,
aber ausschließlich Objekte155,156,157,158 (ohne154), ergibt exakt46 Konturen /
6 freie Enden.42 gehört156,43 gehört158,44/45 gehören157+156,46 ist blockiert.
Bei Inset0,5 ist37 mit `seam-not-on-ring` abgewiesen und44 wegen Verschachtelung.
Siehe `scripts/contour-offset-screenshot-selection-diagnostic.ts`. Die vorherige
Vergleichsauswahl154–158 war falsch, nicht die Benutzerdatei.

Neuer Benutzerbefund: Ausschluss rote Kurve157/Teilpfad6 endet vor gewünschtem
Anschluss; alternative Wahl156/Teilpfad1 nimmt lange geradlinige Seiten mit.
Quellpfadwahl, Intervallrichtung und fehlende präzise Anschlussgrenzen sind als
Auswahlproblem zu behandeln, nicht durch höhere Netzwerktoleranz zu umgehen.
Auswahlkorrektur mit sichtbarer Kandidaten-/Intervallvorschau wird implementiert;
native Abnahme weiter offen. Vorherige Buildtests belegen diesen Ablauf nicht.

## Erneuter Benutzerbefund: zweiter Ausschlusspunkt — 08.11.2026

Nacharbeit implementiert: exakte Bézier-Endpunkte/-Tangenten statt interpolierter
Sehnenpunkte; begrenzte, geordnet geprüfte Übergangsschnitte mit dem Versatzring
statt Annahme, dass jede versetzte kurze Kante noch existiert. T-Verbindungen
innerhalb eines Quellobjekts berücksichtigen auch nichtganzzahlige Quellparameter.
Kollisions-/Verschachtelungs-/Besitz-/Startpunktschutz bleibt aktiv.
10 neue Kurventests bestehen (darunter belegter früherer `seam-not-on-ring`-Fall).
Read-only `frame_test.kzb`,154–158:20 gezielt gekrümmte Intervalle exakt erhalten,
geschlossen und identisch wiedergeöffnet; vorher15. Sieben enge Stichproben
bleiben mit `exclusion-normal-misses-ring` sicher abgewiesen. Gemischte
Blattobjekte bleiben nicht unterstützt. UI erklärt diese Fälle nun gezielt.
Die gespeicherte Datei erkennt47 Konturen, Screenshot46: exakte Benutzerklicks
sind weiterhin nicht nachgewiesen. Keine Behauptung vollständiger Fehlerbehebung
für jeden Ausschluss, keine native Schnittfreigabe.

Screenshot zeigt Objekte156/157/158, nicht die bisher hauptsächlich geprüfte
Objekt187-Variante: richtiger Ausschlussmodus, roter Anfangspunkt, zweiter Punkt
endet mit „Ungültiges Konturversatz-Rezept“. Bisherige erfolgreiche Tests sind
kein Nachweis für diesen konkreten gekrümmten/junction-nahen Bereich.
Geometrieursache wird separat reproduziert; keine pauschale Freigabe der letzten
EXE für diese Auswahl. Dialognacharbeit: Endpunkt bleibt an denselben Quellteilpfad
gebunden (auch an Kreuzungen); abgelehnter Endpunkt erklärt den weiterhin gewählten
Anfang; Bereichsauswahl kann ohne Verwerfen aller gültigen Versätze neu begonnen
werden. Im Ausschlussmodus keine flächige Kontur-Hoverfüllung.

## Ausschlüsse und bestätigte Reststückbereinigung — 08.11.2026

Benutzerentscheidung: Ausgenommene Originalabschnitte bleiben unverändert;
gerade Verbindungen zur versetzten Kontur werden ebenfalls geschnitten.
Im Auswahlmodus **Bereich vom Versatz ausschließen** zwei Punkte auf demselben
Original-Teilpfad anklicken. Der Parameterbereich zwischen beiden Punkten bleibt
rot sichtbar. Mehrere Bereiche sind möglich und einzeln entfernbar; ein Bereich
über den geschlossenen Quellursprung ist in zwei Bereiche aufzuteilen.

Die vollständige Ergebnisgeometrie einschließlich erhaltener Quellreste wird
vorgezeigt, nicht mehr ausschließlich die verschobenen Ringe. Ausnahmen enthalten
exakt extrahierte Bézierkurven mit Originalkoordinaten/Anfassern, keine neu
gefitteten Ersatzkurven. Übergänge werden auf Kollisionen und geänderte
Verschachtelung geprüft. Konturen über mehrere unterschiedliche Blattobjekte,
betroffene feste Startpunkte, vollständig ausgenommene Konturen und mehrdeutige
Übergänge werden derzeit sicher abgewiesen; Gruppen/Quellobjekte werden nie
zusammengeführt.

**Reststücke gezielt entfernen** bietet einzelne Abschnitte zur Auswahl;
orange gestrichelte Löschvorschau und ausdrückliche Bestätigung vor Anwendung.
Keine Löschung nach Länge. Ausnahmen, ungewählte Konturanteile, feste Startpunkte
und konservativ geschützte mehrdeutige Bereiche dürfen nicht beiläufig entfallen.
Bei Auswahl-/Parameteränderung nicht mehr passende Löschwahlen werden verworfen.
Ein vollständig innerhalb eines Quellobjekts zusammengesetzter Ring ist jetzt
formal geschlossen. Vorhandener Layer-Kerf bleibt unverändert und seine zusätzliche
Wirkung auf neu geschlossene Konturen muss bestätigt werden.

Optionale V2-Felder `excluded` und `trimmed` speichern Quellparameterbereiche;
alte V1/V2-Rezepte bleiben lesbar. Originaldefinition, Undo/Redo und
nichtkumulatives Wiederöffnen bleiben erhalten. Dauerhaftes Festschreiben behält
die bisherige separate destruktive Bestätigung.

Prüfnachweis: 27 Konturtests, 11 Ausschlusstests, synthetischer Dialog und
ressourcenbasierter Editor. Read-only `frame_test_2.kzb`, Objekt187 allein,
Toleranz0,2 mm: 42 akzeptierte Innenversätze0,1 mm bzw.39 bei0,8 mm; mit jeweils
einem repräsentativen Ausschluss und ausdrücklich in der Diagnose gewählter
Bereinigung37 bzw.30 ungeschützter Reste entstehen **0 Offen-/Unverbunden-Warnungen**.
Zwei bzw.drei geschützte Reste bleiben erhalten. Dies ist keine Identifikation
aller roten Screenshot-Bereiche und keine automatische Löschregel im Produkt.
Quelldatei unverändert (SHA256 wie unten), keine Maschine/Installation gestartet.
Native Abnahme und exakte Auswahl der gewünschten roten Bereiche bleiben offen.

Substanzielle KI-Unterstützung: GPT 6.1 Sol (OpenAI) via OpenCode, einschließlich
delegierter Geometrieimplementierung; kein unabhängiges menschliches Review.

## Offener Ergebnisfehler — weitere Benutzerabnahme 07.11.2026

**Die letzte EXE ist für diesen Workflow noch nicht freigegeben.** Höhere
Verbindungstoleranz/mehr erkannte Konturen ist kein Korrektheitsnachweis.
Exakter Screenshot-Parametersatz reproduziert: nur Objekt187,
Toleranz0,2 mm, Innenversatz0,1 mm ergibt45 Konturen/6 freie Enden.
In-Memory-Anwendung von42 akzeptierten Konturen erzeugt83 Ergebnis-Unterpfade
und40 neue Offenpfad-Warnungen (vorher0). Darunter16 geometrisch geschlossene,
aber formal offene Schleifen sowie Warnungen an erhaltenen Quellresten.
Die Kreise/orangefarbenen Linien werden vom Designchecker gezeichnet; sie
betreffen tatsächlich die erzeugte Repräsentation und sind nicht bloß Hover.

Eine reine Closure-Korrektur beseitigt die Reststücke nicht. Experimentelle
Änderungen wurden nicht paketiert und die Produktionsdateien auf den vorherigen
Buildstand zurückgeführt (gegen Quellen-ZIP geprüft). Keine Quelldaten geändert.
Vor einer weiteren Freigabe: formale Closure, Herkunft jeder Restspanne,
vollständige Ergebnisvorschau statt nur Versatzringe und normaler Layer-Kerf
(Datei:0,06 mm) gemeinsam klären/testen. Keine pauschale Löschung kleiner Linien.
Diagnose: `scripts/contour-offset-output-diagnostic.ts`, lokale Ergebnisse unter
`artifacts/contour-offset-diagnostic/output-checks*.json`.

## Fehlerkorrektur mit frame_test_2.kzb — 07.11.2026

Read-only geprüft: Originaldatei unverändert, SHA-256
`E2DE5D45AD2E852238E755CE665C0B9FE200A5F674F9435A3D9E11BD67BC2E0F`.
Konkrete Auswahl: Objekte **154 und 187**, Verbindungstoleranz **0,2 mm**,
Versatz **0,2 mm innen**. 46 erkannte Konturen; vorher 31, jetzt **41** einzeln
und auch gemeinsam akzeptiert. Kein bloßes Auswahlmengenlimit als Ursache.
Bei **0,01 mm** Toleranz werden dagegen 28 Konturen erkannt, 22 freie Enden
gezählt und27 Insets akzeptiert. Die toleranzabhängigen Lücken der Quelle sind
damit ein zusätzlicher Faktor; die Toleranz wird niemals automatisch erhöht.
Benutzer bestätigt beim weiteren Screenshot ausdrücklich **0,01 mm**. Die
erneut rot markierten Bereiche dürfen daher nicht pauschal mit den fünf
Ablehnungen des 0,2-mm-Tests gleichgesetzt werden: viele fehlen schon in der
Flächenerkennung. Lokale nummerierte Karten für beide Toleranzen liegen unter
`artifacts/contour-offset-diagnostic/spatial-001.png` und `spatial-02.png`.
Für den Vergleich im bestehenden Build 0,2 mm ausdrücklich einstellen; dabei
wird die noch nicht angewandte Konturwahl zurückgesetzt. Originaldatei und
Quellknoten werden durch diese Erkennungseinstellung nicht umgeschrieben.

- Bei gerundeten Netzkoordinaten können fast kollineare Sackgassen wie ein
  zweiter Randweg aussehen. Die Quellzuordnung zählt nun vollständige monotone
  Wege zum nächsten Polygonpunkt. Genau ein vollständiger Weg ist erforderlich;
  echte alternative Wege und mehrfach belegte Kanten werden weiterhin abgewiesen.
- Eine Kontur aus mehreren Teilpfaden **desselben Blattobjekts** benötigt keine
  künstlichen Nähte zwischen verschiedenen Objekten. Sie wird einmal in genau
  diesem Blatt ausgegeben, während nur die gespeicherten Quellspannen entfernt
  werden. Originaldefinitionen/Teilpfade bleiben im Rezept, unberührte Teile
  bleiben erhalten. Mehrere verschiedene Blattobjekte werden niemals vereinigt.
  Wie zuvor bleiben solche zusammengesetzten Ausgabespannen formal offen (mit
  expliziter geometrischer Schlusskante), damit Layer-Kerf nicht neu aktiviert wird.
  Feste Startpunkte werden weiterhin geschützt; Rezeptversion bleibt V2.
- Ein ungültiger zusätzlicher Klick wird mit Kontur-Nummer/Grund zurückgewiesen,
  ohne die bisherige gültige Auswahl und Vorschau zu löschen. Ungültige Abstand-
  oder Toleranzeingaben sperren Anwenden und lassen nur eine ausdrücklich als
  letzte gültige Vorschau gekennzeichnete Darstellung stehen.

Bei dieser Auswahl/Parametern bleiben Konturen **1, 32, 33, 34 und 41** abgewiesen:
1/34 Verschachtelungsänderung, 32 sich berührende/überschneidende Geometrie,
33 Kollaps einer sehr kleinen Kontur, 41 echte mehrdeutige Mikrokontur.
Diese Prüfungen werden nicht umgangen. Nummerierung ist auswahl-/toleranzabhängig.
Die Zuordnung zu jeder farbigen Handskizzenmarkierung ist nicht pixelgenau belegt.

Verifikation dieser Korrektur: 25 fokussierte Konturversatztests, 33 synthetische
Editor-Browserchecks sowie ressourcenbasierte Editor-/Geometrieprüfungen für
41 Einzel-/Gesamtauswahlen, Fehlerbeibehaltung, Anwenden, Wiederöffnen und Undo.
Bestehende Außenkontur-, Schlitz- und Eingabebrowserchecks erneut bestanden.
Aktueller Windows-Build und tatsächlicher Abschluss: [local-builds.md](local-builds.md).
Noch keine native Benutzerabnahme der Korrektur, keine Hardwareprüfung.

Zugang: **Werkzeuge → Lokaler Konturversatz …**, getrennt vom bisherigen
Offset-Kopierwerkzeug (Alt+O). Quellobjekte oder deren Gruppen zuvor auswählen.
Das kleine verschiebbare Werkzeugfenster bleibt neben der Arbeitsfläche offen.
Konturen per Klick oder Checkbox ein-/ausschalten; Abstand und Innen/Außen für
die gewählten Konturen einstellen. Grau zeigt die Quelle, gestricheltes Türkis
die neue Geometrie. Innen verkleinert die eingeschlossene Fläche, bei einem
Loch also die Öffnung. 0,2 mm je Rand verkleinern eine Lochbreite um 0,4 mm.

## Nichtdestruktiv und dauerhaft

- Standard: Jede betroffene **bestehende Objektinstanz** erhält einen eigenen
  Generator `local-contour-offset-v2` mit Originalform, Original-Unterpfaden,
  Versatzrezept und gecachter Ergebnisgeometrie. Objekt-IDs, Gruppenzugehörigkeit,
  Reihenfolge, Matrizen, Namen, Ebenen und Ausgabeausschlüsse bleiben erhalten.
- Nicht gewählte Unterpfade bleiben einschließlich Bézier-Anfassern und
  Startmarkierungen unverändert. Es entsteht kein neues Sammelobjekt. Auch eine
  über mehrere Objekte geschlossene Kontur wird nach dem Versatz in genau die
  bisherigen Quellabschnitte zurückverteilt. Offene Abschnitte bleiben offen;
  ihre gemeinsamen Endkoordinaten ergeben die geschlossene Kette.
- Wiederöffnen über das Menü (bei alleinstehenden Modifierobjekten auch per
  Doppelklick) bearbeitet die Originalbasis, nicht das bereits versetzte Ergebnis.
  Bei verteilten Konturen alle beteiligten Quellobjekte/Gruppen auswählen.
  „Alle lokalen Versätze entfernen“ plus Anwenden stellt die Originalformen wieder her.
- **Dauerhaft festschreiben (destruktiv)** erfordert eine zusätzliche Bestätigung.
  Betroffene Formen werden innerhalb derselben Objekte zu Pfaden; Original- und
  Rezeptdaten entfallen. Undo stellt auch diese Definitionen wieder her.
- Anwenden ist eine atomare Transaktion mit einem Undo-Schritt. Abbrechen/Esc
  verwirft die Vorschau. Veraltete Auswahl/Quellen schließen das Werkzeug.

## Grenzen und Sicherheit

Die Verbindungstoleranz (0–0,5 mm, standardmäßig 0,01 mm) verwendet dieselbe
Netz-/Flächenerkennung wie das Außenkontur-Werkzeug, einschließlich T-Knoten,
Endpunkt-auf-Kante und Kreuzungen. Erkannte Grenzen mit doppelten Besitzern
bleiben sichtbar, sind aber gesperrt. Gemeinsam genutzte Konturkanten werden
nicht willkürlich einem Besitzer zugewiesen; ihre Anwendung wird abgewiesen.
Freie Linienenden werden separat gezählt. Beim Ändern der Toleranz werden noch
nicht angewandte Versätze verworfen; gespeicherte wieder geladen.

V2 verfolgt Original-Unterpfade und Kurvenparameter. Mehrere lokale Versätze in
einem Unterpfad sind möglich; unbetroffene Teilstücke behalten ihre Bézier-Geometrie.
Die Ausgabe kann im selben Quellobjekt in mehrere Unterpfade aufgeteilt werden.
Feste Startpunkte bleiben erhalten oder die Aufteilung wird ausdrücklich abgewiesen.
V1 bleibt lesbar: eindeutig übernehmbare Rezepte werden adoptiert, sonst wird die
Originalkontur als bestehender Legacy-Versatz angeboten. Erst Anwenden schreibt
V2; Wiederöffnen allein verändert keine gespeicherten Definitionen.

Abstand: 0,001–20 mm. Kurven werden fein auf dem vorhandenen 0,001-mm-Raster
angenähert. Clipper-Miter mit begrenzten Ecken; verteilte Konturen werden an ihren
zugeordneten Nähten zurückverteilt. Nicht eindeutig abbildbare Nähte werden
gesperrt, statt Kantenbesitzer umzuverteilen. Kollaps, Aufspaltung, Selbstschnitt, Kontakte/Überschneidungen mit
anderen erkannten Konturen und Änderungen der Verschachtelung werden abgewiesen.
Unaufgelöste offene Linien sind kein zertifizierter Kollisions-/Stegbreitennachweis.

Layer-Kerf wird weder verändert noch ersetzt. Er wirkt weiterhin nach seinen
vorhandenen Regeln auf die Ergebnisgeometrie: geschlossene Unterpfade werden
kompensiert, offene Abschnitte nicht automatisch zu einem Kerf-Verbund vereinigt.
Der lokale Versatz ist keine Messung der realen Schnittfuge oder Materialpassung.

Gesperrte/unsichtbare Quellen, Bilder, Text/Barcodes, gebundene Formmaße,
Generatorbindungen, Baugruppenteile und aktive Verbindungs-Metadaten werden nicht
still aufgelöst, sondern abgewiesen. Unterstützte unabhängige Generatorquellen
bleiben als Originaldefinition erhalten; das Werkzeug ist kein Live-Editor für
die eingebetteten Quellgeneratoren. Geänderte oder unvollständige Besitzerketten
werden beim erneuten Bearbeiten abgewiesen. Ältere Leser können die gecachte
`gen`-Geometrie weiter verwenden, kennen aber nicht den neuen Editor.

## Nachweise

Aktueller gemeinsamer Windows-Testbuild einschließlich V2 und Eingabefixes:
`artifacts/windows-editor-followup-20261107-140712/`,
`KizamuBeam-editor-followup.exe` plus NSIS. Build bestanden, Quellarchiv und
Quell-/Binärhashes geprüft; nicht gestartet/installiert. [Buildnachweis](local-builds.md).

- `npm run test:contour-offset`: 22 Prüfungen bestanden: Geometrie, Root-/Unterpfadzugehörigkeit,
  nichtkumulative Bearbeitung, dauerhafte Variante, Undo/Redo, Persistenz,
  Transformierungen, Fehlerfälle und Offline-Jobgleichheit mit unabhängigem Kerf.
- `window.runContourOffsetChecks()` im echten isolierten Chromium-Editor:
  27 Prüfungen bestanden; Vorschau, Wahl, Regeneration, Bestätigung, Restore,
  Abbruch und Listenerbereinigung.
- Read-only `frame_test.kzb`, Objekte 154–158, Toleranz **0,2 mm**: beide Werkzeuge
  erkennen **47 Konturen**, davon drei mit gesperrter Quellzuordnung; ein freies
  Linienende bleibt. 31 einzelne 0,2-mm-Insets akzeptiert, übrige wegen Zuordnung,
  Kollaps oder Topologie abgewiesen. Bei 0,05 mm erkennen beide 37 Konturen.
  Quelldatei unverändert; größere Toleranz ist keine automatische Reparatur.
- Native Bedienung, reale Materialpassung und physischer Schnitt bleiben offen.
  Kein Start/Installieren der Anwendung und keine Maschinenverbindung durch den Agenten.

Weitere ausgeführte Regressionen: `test:outline` (24), `test:interaction` (21),
`test:vector` (9 + 16), `test:slot-features`, `test:slot-worker`,
`test:generators`, `test:gcode`, `i18n:check` (0 fehlende Übersetzungen).
Realer Chromium: Außenkontur 31/31 und Schlitzfunktionen 96/96 bestanden,
einschließlich Ctrl+wheel und Gesture-Fallback auf der Schlitzvorschau.

Historischer Windows-Testbuild (nur V1, ohne neue Erkennung und Eingabefixes):
`artifacts/windows-contour-offset-20261107-030607/`
mit `KizamuBeam-contour-offset.exe`, NSIS-Installer, Buildlog, Browsernachweisen,
Quellarchiv und SHA-256-Manifesten. Quell-Hashes nach der Paketierung erneut
geprüft. Nicht gestartet oder installiert.

Wesentliche KI-Unterstützung: **GPT 6.1 Sol (OpenAI) via OpenCode**.
