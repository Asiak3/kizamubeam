# Windows-Testbuild: manuelle Abnahme

Nur mit neuem, synthetischem Projekt testen. Keine Maschine verbinden, keine
Bewegung oder Laseraktivierung auslösen. Bestehende Projekte nicht überschreiben.
Der Testbuild verwendet die normale App-Identität und kann dieselben Einstellungen
wie die installierte Version verwenden; vor dem Test eigene Daten sichern und
die installierte Anwendung schließen. Den Installer zunächst nicht ausführen.

## Aktuelle Zusatzabnahme — 2026-11-07

### Konturversatz-Nacharbeit frame_test_2.kzb

Datei als Kopie öffnen, Objekte154 und187 gemeinsam wählen, **Werkzeuge →
Lokaler Konturversatz …**. Für den dokumentierten Vergleich ausdrücklich
Verbindungstoleranz **0,2 mm**, Abstand **0,2 mm**, Richtung **Innen** setzen.
46 Konturen werden erkannt,41 sind bei diesen Parametern gültig. Niedrigere
Toleranz erkennt weniger geschlossene Bereiche (0,01 mm:28), kein automatisches
Schließen der gespeicherten Quelle. Grenzfallwarnungen nicht umgehen.

Mehrere gültige Konturen auswählen, dann eine abgelehnte: vorherige Auswahl und
Vorschau müssen stehen bleiben, mit Kontur-Nummer und Ablehnungsgrund. Bei
ungültiger Abstands-/Toleranzeingabe muss Anwenden gesperrt und die Darstellung
als letzte gültige Vorschau erklärt sein. Eingabe korrigieren, erneut wählen,
Anwenden, Wiederöffnen und Undo prüfen. Quellobjekte/IDs/Gruppen müssen bleiben.

### Vier neue Draft-Funktionen im kombinierten Editor-Round-Build

Diese vier Funktionen werden nun gemeinsam mit allen bisherigen lokalen
Anpassungen als Windows-Testbuild paketiert. Die PRs #175–#178 bleiben Draft.
Nur eine Kopie eines Testprojekts verwenden, keine Maschine verbinden.
Synthetische Vorlage: [editor-round-test.svg](editor-round-test.svg), ohne
Maschinenbefehle. In ein neues Projekt importieren; falls als Gruppe importiert,
zuerst Gruppierung aufheben. Oben links liegt der Inselpfad (2 mm Abstand), oben
rechts der offene Freihandpfad, unten links zwei deckungsgleiche Kurven, unten
rechts eine weitere Kurve für die Anfasserprüfung. Nicht als Schneidjob ausführen.

1. **Pfadinseln:** Einen gewöhnlichen zusammengesetzten Pfad mit zwei getrennten
   Außenbereichen und einem Loch auswählen. **Werkzeuge → Pfad → Pfadinseln
   trennen …** öffnen. Bei 0 mm werden getrennte Materialinseln zu Objekten,
   die zugehörigen Löcher bleiben dabei. Abstand erhöhen: nahe Inseln bleiben
   gemeinsam in einem Objekt, ohne dass Geometrie verbunden wird. Optionales
   Lückenschließen separat wählen; Schlusskante in Vorschau und Bestätigung
   beachten. Abbrechen sowie Übernehmen/Undo/Redo testen.
2. **Freihand:** Einzelnen gewöhnlichen Pfad auswählen und **Werkzeuge → Pfad →
   Freihandpfad bearbeiten …** öffnen. Fortsetzen wählen, Werkzeug starten und
   an einem Endknoten ziehen. Für Neuzeichnen am vorhandenen Knoten anfangen und
   an einem anderen Knoten desselben Teilpfads loslassen. Unberührte Abschnitte
   und Löcher müssen erhalten bleiben. Escape verwirft den laufenden Strich.
   Der feste Schnittstart wird nicht still durch Fortsetzen am Anfang verschoben.
3. **Lasso/Anfasser:** **Werkzeuge → Pfad → Lasso-Auswahl** umschließt ganze
   Objekte (einschließlich Bounding Box). Im Knotenwerkzeug **Knoten-Lasso**
   aktivieren, dann aus leerem Bereich ziehen; Alt zieht auch direkt über einer
   Komponente. Shift ergänzt, Ctrl schaltet um, Shift+Ctrl entfernt. Griffe mit
   Shift-Klick mehrfach wählen, einen gewählten Griff ziehen; anschließend
   Pfeiltasten, Entf und Undo testen. Bei Mehrfachgriffbewegung werden Glatt-
   Bindungen der betroffenen Knoten bewusst gelöst, nicht ungewählte Griffe bewegt.
4. **Überlappung:** Zwei Objekte übereinanderlegen, Auswahlwerkzeug aktivieren.
   Rechts ca. 0,55 s gedrückt halten und loslassen. In der Liste über Einträge
   fahren: Magenta-Hervorhebung ohne Auswahländerung. Klick wählt das verdeckte
   Objekt. Escape/Außenklick bricht ab, kurzer Rechtsklick bleibt Kontextmenü.
   **Datei → Überlappungsauswahl einstellen …**: Auslöser Rechts-/Links-Hold/aus
   und Haltedauer ändern. Gruppen bleiben normale auswählbare Gruppen.

Bleistift, Pinch-Zoom und Dateidrop wurden vom Benutzer bereits bestätigt.
Die älteren allgemeinen Testvorschläge unten sind keine erneute Fehlermeldung.

Die folgenden Punkte gelten für den neuen gemeinsamen Editor-Follow-up-Build.
Ältere Schlitzabläufe weiter unten sind historisch; für das aktuelle Werkzeug
gelten [Schlitzfunktionen](slot-features.md) und [Konturversatz](contour-offset.md).

- **Bleistift:** sichtbaren, entsperrten Layer wählen; „Geschlossener Pfad“ zuerst
  aus. Mit gedrückter linker Maustaste ziehen und loslassen. Pfad und Status
  „Freihandpfad erstellt“ müssen bleiben; Undo/Redo prüfen. Separat: Escape mitten
  im Strich darf keinen Pfad erzeugen; ein bloßer Klick erklärt das fehlende Ergebnis.
  Bei weiterem Fehler Status, Eingabegerät, Layer und Schließen-Option notieren.
- **Pinch:** Zwei-Finger-Pinch auf Arbeitsfläche und separat in der Schlitzvorschau.
  Nur die Zeichnung soll zoomen, nicht Menü-/Schriftgröße. Mausanker, normale
  Mausradbedienung und Fit prüfen; keine Geometrie-/Undo-Änderung durch Navigation.
- **Dateidrop:** kleine synthetische SVG und PNG aus Explorer auf Arbeitsfläche
  ziehen, dann Undo. Mehrere Dateien und Windows-Skalierung >100 % prüfen.
  Drop auf Bibliothek muss dort landen; interne Objekt-/Bibliotheksdrags separat
  prüfen. Außerhalb geeigneter Panels darf die App-Seite nicht ersetzt werden.
- **Objekte:** neues Projekt und importierte Objekte starten mit geschlossenen
  Layern/Gruppen. Manuell öffnen, Objekt ändern/auswählen und wieder schließen;
  die Wahl soll bei Baumaktualisierungen bleiben. App-Neustart-Persistenz wurde
  nicht hinzugefügt.
- **Konturversatz:** gleiche Quellen und gleiche Toleranz wie beim Außenkontur-
  Werkzeug verwenden. Erkannte Konturen müssen übereinstimmen; eine gesperrte
  Besitzerzuordnung ist kein Grund, Objekte automatisch zusammenzuführen.
  Vorschau, Abbrechen, Anwenden, Wiederöffnen, Rücksetzen und Undo prüfen.
  Im Objekte-Baum müssen IDs/Gruppenzugehörigkeit erhalten bleiben. Dauerhaftes
  Festschreiben nur nach Bestätigung testen; bestehende Projekte nicht überschreiben.

## Vektorwerkzeuge und Formerstellung

- Zwei überlappende Rechtecke zeichnen, gemeinsam auswählen, Formerstellung starten.
- Überlappung hervorheben; Flächen per Klick/Ziehen verbinden, per Alt entfernen.
- Mehrere Striche, Escape, Undo/Redo prüfen. Kein unerwarteter Geometrieverlust.
- Hinweis zur ersten Übernahme beachten: Originale bleiben erhalten und werden
  auf „Nicht lasern“ gesetzt. Ergebnisse sind unabhängige Pfade.
- Ein parametrisches Bauteil testen: Originalparameter bleiben bearbeitbar.
- Gruppen/offene Linien müssen mit Hinweis abgelehnt werden.
- Vereinfachen: Vorschau, Abbrechen und Übernehmen; danach Undo prüfen.
- Knoten/Segmente mehrerer Pfade bearbeiten; Pencil zeichnen und abbrechen.

## Kontextmenüs

## Schlitze / Ausklinkungen — lokale Tests ongoing

### Neuer konturgeführter Ablauf

- „Konturgeführt“ wählen; Breite/Spiel/Faktor und Eindringtiefe vorgeben.
- Tiefenreferenz wechseln: Kontur auf Mittelachse oder Verbindung der Öffnungsecken.
  An einer Rundung muss das einen nachvollziehbaren Unterschied ergeben.
- „Auf der Arbeitsfläche platzieren“: nahe an eine Kontur fahren. Öffnungsecken
  und Ausrichtung müssen folgen; klicken setzt ab, weitere Klicks fügen hinzu.
  „Fertig“ oder Escape kehrt zum Dialog zurück. Erst Übernehmen ändert das Projekt.
- Kreis und freie Kurve prüfen; zu große Breite/enge Krümmung muss einen Hinweis
  statt einer falschen Platzierung ergeben. Außerhalb des Fangbereichs kein Snap.
- Für jeden Schnitt eigene Referenz wählen: Punkt auf Grundkontur, X/Y lokal
  oder vorhandener Schnitt (Mitte/erste/zweite Öffnungskante). Konturabstand und
  Laufrichtung einstellen. Bei explizitem Maß ersetzt das Maß die freie Mausposition.
- Bezugsschnitt verschieben und seine Breite ändern: Folgeschnitte müssen entlang
  der Kontur mitwandern. Mehrstufige Ketten, Speichern/Laden und Undo prüfen.
- Kreisverweis und Löschen eines referenzierten Schnitts dürfen nicht still
  funktionieren. Bezug zuerst ändern. Bodenkanten sind noch keine Referenzziele.
- Arbeitsflächenplatzierung derzeit nur bei unskalierten Objekten einschließlich
  Drehung/Spiegelung. Bei Skalierung/Scherung muss ein Hinweis erscheinen.

### Bisheriger freier Modus / Kompatibilität

- Einzelnes Rechteck auswählen, „Schlitze / Ausklinkungen platzieren …“ öffnen.
- Für die folgenden freien Platzierungstests ausdrücklich „Frei platzieren“ wählen.
- 3,7 mm Nennbreite, 0,1 mm Spiel: resultierende Breite 3,8 mm. Layer-Kerf
  bleibt eine getrennte zusätzliche Ausgabekorrektur.
- In der Vorschau bewegen, dann innen klicken; für eine Ausklinkung über den
  Rand setzen. Drehung, Tiefe und Positionswerte prüfen.
- Mehrere Ausschnitte über „Neuen Ausschnitt platzieren“ hinzufügen; in der Liste
  wieder auswählen, ändern und entfernen. Apply/Cancel sowie Undo/Redo prüfen.
- Nicht destruktiv übernehmen und per Doppelklick wieder öffnen; speichern,
  schließen und Testprojekt erneut laden. Keine privaten Projekte überschreiben.
- „Originalform wiederherstellen“ und Undo prüfen. Destruktives Festschreiben
  nur nach ausdrücklicher Bestätigung; danach soll es ein gewöhnlicher Pfad sein.
- Grenzen: lokale Koordinaten im Vorschaufenster, keine automatische Kantenbindung,
  keine Gruppen/Baugruppenteile. Ursprüngliche Generatorparameter sind gespeichert,
  aber nicht durch den Wrapper hindurch live editierbar.

## Außenkontur — lokale Tests ongoing

- Formen auf mehreren Layern auswählen, „Außenkontur mit gewählten Löchern …“.
- Standardmäßig keine Innenlöcher. Gewünschte Innenflächen anklicken oder per
  Checkbox wählen; getrennte Außenbereiche dürfen nicht überbrückt werden.
- Zielebene, Originale behalten bzw. bestätigtes Ersetzen, Abbrechen und Undo
  testen; besonders kleine Lücken/geschwungene Konturen visuell prüfen.

## Kontextmenüs (Fortsetzung)

- Rechtsklick auf bereits ausgewähltes Objekt erhält Mehrfachauswahl.
- Vektor, einzelnes Bild, mehrere Bilder, Knoten und leere Fläche ausprobieren.
- Deaktivierte Aktionen dürfen nichts ändern. Tastatur, Untermenüs, Escape und
  Außenklick testen; Fokus muss sinnvoll zurückkehren.
- Bei geöffnetem Dialog darf kein konkurrierendes Editormenü entstehen.
- Kopieren/Einfügen und Menü-Shortcuts mit den normalen Befehlen vergleichen.

## Isolation

- Auswahl isolieren: Außenobjekte nicht sichtbar/auswählbar und keine Snap-Ziele.
- Neue Objekte sowie Einfügen innerhalb der Isolation testen.
- Isolation verlassen: Außenobjekte und ursprüngliche Auswahl kehren zurück.
- Undo/Redo, Seiten- und Tabwechsel dürfen keine veraltete Isolation hinterlassen.
- Warnhinweis beachten: Isolation ist **kein Ausgabefilter**. Nur die vorhandene
  Ausgabevorschau prüfen, keinen Job senden; „Nur Auswahl“ bleibt unabhängig.

## Rückmeldung

Für Auffälligkeiten Funktion, Schritte, erwartet/tatsächlich und gegebenenfalls
Screenshot oder synthetisches Beispiel notieren. Bediengefühl und native
WebView-/Fokusprobleme sind durch die automatisierten Tests nicht abgedeckt.
