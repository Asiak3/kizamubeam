---
sidebar_position: 7
title: Bilder und Nachzeichnen
description: Fotos mit Dithering und anderen Bildmodi gravieren, anpassen, Hintergründe entfernen, zuschneiden und maskieren und Bilder in Vektoren nachzeichnen.
---

# Bilder und Nachzeichnen

## Bilder importieren

**Datei → Importieren** (Ctrl+I), Ziehen und Ablegen oder Einfügen (Ctrl+V) holt PNG, JPG, BMP, GIF, WebP und TIFF herein. Die Größe ergibt sich aus der in der Datei gespeicherten Auflösung (254 DPI, wenn keine angegeben ist); zu große Bilder werden auf das Bett verkleinert.

Ein Bild liegt wie jedes andere Objekt auf einem Layer. Geschwindigkeit, Leistung, Durchgänge, Zeilenabstand und die übrigen Lasereinstellungen kommen vom Layer; ein Doppelklick auf das Bild öffnet die Layer-Einstellungen mit ihrem Abschnitt **Bild**.

## Bildmodi

Jedes Bild hat seinen eigenen **Bildmodus**, der bestimmt, wie aus Grautönen Laserpunkte werden. Die Arbeitsfläche zeigt das Ergebnis in Laserauflösung.

| Modus | Gut für |
|---|---|
| **Schwellwert** | Logos und Strichzeichnungen: Alles, was dunkler als der Schwellwert ist, wird gelasert. |
| **Geordnet** | Gleichmäßiges, regelmäßiges Punktmuster. |
| **Floyd-Steinberg**, **Atkinson**, **Stucki**, **Jarvis** | Fotos. Fehlerverteilendes Dithering mit unterschiedlichem Charakter; Atkinson behält mehr Kontrast, Stucki und Jarvis geben feinere Übergänge. |
| **Zeitungsdruck (Newsprint)** | Ein runder Punkt pro Rasterzelle, dessen Größe der Helligkeit folgt, mit einstellbaren Zellen pro Zoll und Rasterwinkel. |
| **Halbton** | Klassischer Halbton-Look. |
| **Skizze** | Macht Kanten zu dunklen Strichen und lässt gleichmäßige Flächen frei. |
| **Graustufen** | Ändert die Leistung zwischen Min. und Max. Leistung des Layers; für Materialien, die gleichmäßig dunkler werden. |

**Negativ** kehrt das Bild um, etwa für dunkle Materialien, die beim Lasern hell werden.

## Bilder anpassen

**Werkzeuge → Bild → Bild anpassen …** stellt Helligkeit, Kontrast, Gamma, Schärfen (mit Radius) und Entrauschen ein, mit Vorschau, Vergleich mit dem Original und 1:1-Ansicht. Anpassungen und Bildmodus lassen sich als benannte Voreinstellungen speichern.

**Bearbeitetes Bild speichern …** speichert das Bild als PNG genau so, wie es gelasert würde.

## Hintergrund entfernen

**Werkzeuge → Bild → Hintergrund entfernen …** (oder **Freistellen …** in der Leiste) arbeitet lokal, ohne Cloud-Dienst. Die Hintergrundfarben werden vom Bildrand genommen, oder du klickst sie in der Vorschau an (Shift+Klick fügt weitere hinzu). Farben innerhalb der Toleranz werden transparent und nicht gelasert. Die Bereinigung entfernt kleine Flecken und füllt kleine Löcher; **Auf das Motiv zuschneiden** beschneidet das Bild.

## Zuschneiden und maskieren

Wähle ein Bild und eine oder mehrere geschlossene Formen aus:

- **Werkzeuge → Bild → Bild zuschneiden** beschneidet das Bild auf den Begrenzungsrahmen der Form.
- **Werkzeuge → Bild → Maske auf Bild anwenden** behält nur das Innere der Formen (auch Text geht); der Rest wird transparent.

Das Bild behält Position und Auflösung; Ctrl+Z macht beides rückgängig.

## Bilder nachzeichnen

**Werkzeuge → Bild → Bild nachzeichnen …** (Alt+T) macht aus einem Bild Vektorpfade, mit Live-Vorschau. Stelle den Schwellwert ein, ignoriere kleine Flecken und wähle die Glättung. Das Ergebnis sind Bézierpfade mit erhaltenen Ecken.

Die Art **Mittellinien** zeichnet Striche entlang ihrer Mitte als offene Pfade nach. Das ist die richtige Wahl für Handschrift, Unterschriften und Strichzeichnungen, die als einzelne Linie geritzt statt umfahren werden sollen.

Nach dem Nachzeichnen verringert [Pfade vereinfachen / glätten](paths.md#simplifying-paths) bei Bedarf die Zahl der Knoten.
