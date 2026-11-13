---
sidebar_position: 11
title: Materialien und Tests
description: Bewährte Einstellungen in der Material-Bibliothek speichern und mit Materialtest, Fokustest und Passungs-Kalibrierung finden.
---

# Materialien und Tests

Gute Ergebnisse hängen von der richtigen Geschwindigkeit, Leistung und dem Fokus für jedes Material ab. KizamuBeam hilft dir, diese Werte mit Testmustern zu finden, und hebt sie in einer Material-Bibliothek auf, sodass du sie nur einmal suchen musst.

## Material-Bibliothek {#material-library}

Das Fenster **Material** speichert Schnitteinstellungen je Material und Dicke, auf Wunsch auch mit den Bildeinstellungen. Um einen Eintrag zu nutzen, wähle einen Layer aus und wende den Eintrag darauf an; der Layer übernimmt alle seine Einstellungen.

- **Speichern**: Richte einen Layer so ein, wie du ihn haben willst, und speichere ihn als neuen Eintrag (Material, Dicke, Titel).
- **Austauschen**: Einträge als `.kzm`-Dateien exportieren und importieren. Ältere `.lwm`-Dateien lassen sich weiter importieren, und LightBurn-Bibliotheken (`.clb`) werden übernommen, soweit ihre Felder eine Entsprechung haben.
- **Erweiterungen** können ebenfalls Materialeinträge mitbringen (siehe [Vorlagen, Bibliothek und Erweiterungen](templates-library.md#extensions)).

Materialeinträge tragen auch das [Aussehen in 3D](construction-3d.md#material-look) und die Ergebnisse einer [Passungs-Kalibrierung](#calibrate-fit).

## Materialtest {#material-test}

**Laser → Test und Kalibrieren → Materialtest …** (oder **Werkzeugkasten → Laser und Kalibrieren**) erzeugt ein Raster aus Testfeldern mit zwei abgestuften Werten, etwa Geschwindigkeit in den Zeilen und Leistung in den Spalten, mit Beschriftung. Jedes Feld bekommt einen eigenen Test-Layer.

Der Test verändert dein Dokument nicht: Schicke ihn direkt aus dem Dialog mit Vorschau, Rahmen, Start oder G-Code speichern an den Laser. Die Felder laufen in der Reihenfolge steigender Energie, sodass ein vorzeitig abgebrochener Test die schonenden Felder schon erledigt hat.

Typische Anwendungen:

- **Gravieren**: Geschwindigkeit und Leistung für die gewünschte Dunkelheit ohne Verbrennen finden.
- **Schneiden**: die höchste Geschwindigkeit finden, die noch durchschneidet (Durchgänge im Dialog einstellen).
- **Ritzen**: eine Linie finden, die sichtbar ist, aber nicht tief geht.

## Materialtest per Foto auswerten

**Laser → Test und Kalibrieren → Materialtest auswerten …** (oder **Foto auswerten …** im Testdialog) hilft beim Ablesen:

1. Nimm ein Bild mit der angeschlossenen Kamera auf oder öffne ein Foto (etwa vom Handy).
2. Klicke die vier Ecken des Feldrasters an. Mit kalibrierter Kamera und absolutem Start wird das Raster automatisch gesetzt.
3. Klicke das beste Feld im Foto an und übernimm seine Werte für den aktiven Layer oder speichere sie in der Material-Bibliothek.

KizamuBeam misst, wie dunkel jedes Feld gegenüber dem blanken Material in den Zwischenräumen ist, und schlägt bei Gravuren das Feld vor, das fast so dunkel wie das dunkelste ist, aber am wenigsten Energie braucht. Ob ein Feld verbrannt oder durchgeschnitten ist, beurteilst weiterhin du.

## Fokustest

**Laser → Test und Kalibrieren → Fokustest …** hilft, den richtigen Abstand zwischen Laserkopf und Material zu finden.

- **Rampe** funktioniert mit jedem Laser. Lege das Material schräg auf ein Unterlegstück, lasere eine lange Linie mit Höhenmarken darunter und klicke im Dialog die schärfste Stelle an. KizamuBeam sagt dir, wie weit der Fokus daneben liegt.
- **Z-Reihe** braucht eine motorisierte Z-Achse. Sie lasert eine Reihe kurzer Linien, jede mit anderem Z-Versatz. Klicke die schärfste an, um ihren Versatz in den Layer einzutragen oder Z direkt dorthin zu fahren.

Wie der Materialtest verändert auch der Fokustest dein Dokument nie.

## Passung kalibrieren {#calibrate-fit}

Steckteile passen nur, wenn Kerf und Spiel stimmen. **Laser → Test und Kalibrieren → Passung kalibrieren …** (auch im Werkzeugkasten und im Fenster Material) legt Testteile auf einer neuen Seite an:

- ein Quadrat 20 × 20 mm, um die Schnittbreite zu messen,
- einen Schlitzkamm mit abgestuften Schlitzbreiten,
- eine Lochplatte mit Zapfenkamm mit abgestuftem Spiel.

Die Nummern werden auf einem eigenen Layer graviert. Miss nach dem Lasern das Quadrat und gib es ein, zusammen mit der Nummer des am besten passenden Zapfens und Schlitzes. KizamuBeam berechnet Schnittbreite, Spiel je Seite und Schlitzzugabe und speichert sie beim Material in der Bibliothek. Ein Kerf-Versatz des Layers wird berücksichtigt.

Ab dann übernehmen neue Boxen, Schubladen, Einsätze und Regale Dicke, Kerf und Spiel aus der Kalibrierung des Layer-Materials, und das Werkzeug Verbindung schlägt passende Werte vor. Vorhandene Teile bekommen eine Schaltfläche, um die kalibrierten Werte zu übernehmen, und die [Konstruktionsprüfung](construction-3d.md#check-the-design-before-cutting) vergleicht Verbindungen mit der Kalibrierung.

## Projektnotizen {#project-notes}

**Fenster → Notizen** hält Notizen zum Material (Art, Dicke, Bezugsquelle), zum Aufbau (Fokus, Bett, Ursprung, wie das Werkstück gehalten wird) und zur Bearbeitung (Reihenfolge, Durchgänge, Nachbearbeitung, was du nächstes Mal ändern willst) fest. Die Notizen werden in der Projektdatei und in Vorlagen gespeichert, so beginnt der nächste Durchlauf mit dem, was du gelernt hast.
