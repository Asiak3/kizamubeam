---
sidebar_position: 8
title: Import und Export
description: SVG-, DXF-, PDF-, Illustrator- und LightBurn-Dateien hereinholen und Entwürfe und G-Code exportieren.
---

# Import und Export

## Importieren

**Datei → Importieren …** (Ctrl+I), Dateien auf die Arbeitsfläche ziehen oder mit Ctrl+V aus anderen Programmen einfügen funktioniert jeweils gleich. Farben werden der nächstgelegenen Palettenfarbe zugeordnet, also dem nächstgelegenen Layer, und mehrere Objekte kommen als Gruppe an.

### SVG

Pfade (auch Bögen), Rechtecke, Kreise, Ellipsen, Linien, Polygone, `use`-Verweise, Transformationen, CSS-Klassen und eingebettete Bilder. Die Größe ergibt sich aus `width`, `height` und `viewBox`. **Text in SVG-Dateien wird übersprungen**: Wandle Text im Zeichenprogramm vor dem Speichern in Pfade um.

### DXF

Linien, Polylinien mit Bögen, Kreise, Bögen, Ellipsen, Splines und Blöcke, mit den in der Datei gespeicherten Einheiten und echten Farben. Einzelne Linien, die sich berühren, werden zu durchgehenden Pfaden verbunden, sodass eine aus vielen Stücken gezeichnete Kontur als eine Form geschnitten werden kann.

### PDF und Adobe Illustrator

Pfade bleiben Bézierkurven; RGB-, CMYK-, Grau- und Volltonfarben werden Layern zugeordnet; eingebettete Bilder kommen mit. Text wird aus den in der Datei eingebetteten Schriften zu Umrissen. Nicht eingebettete Schriften werden aus deinem System oder dem Schriften-Manager genommen; fehlt eine, sagt KizamuBeam, welche ersetzt wurde.

Die erste PDF-Seite landet auf der aktuellen Seite, jede weitere auf einer neuen Projektseite. Illustrator-Dateien ab Version 9 funktionieren, weil sie eine PDF-Fassung enthalten. PDFs, die nur gegen Bearbeiten geschützt sind, lassen sich importieren; Dateien, die zum Öffnen ein Passwort brauchen, nicht.

### LightBurn-Projekte

`.lbrn2`-Dateien lassen sich öffnen (**Datei → Öffnen**, als neues Projekt) oder in das aktuelle Projekt importieren. Formen, Gruppen, Bilder mit ihren Anpassungen und Positionen bleiben erhalten. Layer übernehmen Name, Modus, Geschwindigkeit, Leistung, Durchgänge, Ausgabe, Reihenfolge, Füll- und Bildeinstellungen, Sub-Layer, Perforation, Anschnitte, Überschnitt, Leistungsrampe und Z-Einstellungen. Text bleibt bearbeitbarer Text, wenn die Schrift installiert ist; sonst bleiben seine Umrisse als Pfad erhalten. Was sich nicht importieren ließ, steht in der Statusleiste und in der Konstruktionsprüfung.

LightBurn-Materialbibliotheken (`.clb`) lassen sich in der Material-Bibliothek importieren.

### 3D-Modelle

STL- und OBJ-Dateien werden zu Schicht- oder Rippenmodellen aus flachen Teilen. KizamuBeam fragt, welches von beiden du möchtest; siehe [Generatoren](../generators/index.md).

### Bilder

Siehe [Bilder und Nachzeichnen](images.md).

## Exportieren

**Datei → Exportieren** (auch als Schaltflächen in der Leiste):

| Format | Was exportiert wird |
|---|---|
| **SVG** | Die aktuelle Seite, mit Bildern. |
| **DXF** | Die aktuelle Seite in mm, ein DXF-Layer pro verwendetem Layer mit Name und Farbe. Kurven werden als exakte Splines exportiert. Bilder können nicht in DXF. |
| **PDF** | Alle Seiten, jede in Bettgröße 1:1, jeder Layer als eigene PDF-Ebene, Füll-Layer gefüllt, Bilder eingebettet. |
| **Illustrator (`.ai`)** | Dieselbe PDF-kompatible Datei; öffnet in Illustrator, Inkscape und Affinity. |

Texte werden als Umrisse exportiert.

## G-Code

**Laser → G-Code speichern …** schreibt den Job der aktuellen Seite für das gewählte Gerät, genau so, wie er an den Laser ginge, einschließlich der G-Code-Skripte des Geräts. So lassen sich Jobs von einer SD-Karte oder mit einem anderen Programm ausführen.

## Einstellungen übertragen

**Datei → Einstellungen übertragen …** exportiert Einstellungen, Geräte, Material-Bibliothek, Bibliothek, Vorlagen, Erweiterungen und Fensteranordnung in eine `.kzs`-Datei, als Sicherung oder für einen anderen Rechner. Siehe [Anpassen und Einstellungen](customizing.md).
