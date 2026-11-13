---
sidebar_position: 2
title: Dateiformate
description: Welche Dateien KizamuBeam öffnet, importiert und exportiert.
---

# Dateiformate

## Import

**Datei → Importieren** (Ctrl+I), per Drag-and-drop aus dem Dateimanager oder mit Ctrl+V einfügen.

| Format | Hinweise |
|---|---|
| Bilder: PNG, JPG, BMP, GIF, WebP, TIFF | Größe aus der Auflösung der Datei (254 DPI, wenn keine angegeben ist). Mehrseitiges TIFF: erste Seite. |
| SVG | Pfade, Grundformen, Transformationen, eingebettete Bilder. Texte werden übersprungen; wandle sie vor dem Speichern des SVG in Pfade um. |
| DXF | Linien, Polylinien mit Bögen, Kreise, Bögen, Ellipsen, Splines und Blöcke. Einheiten aus der Datei. |
| PDF | Pfade bleiben Kurven, Farben werden Layern zugeordnet, eingebettete Bilder und Text (als Umrisse). Jede Seite kommt auf eine eigene Projektseite. |
| Adobe Illustrator (`.ai`) | Dateien ab Illustrator 9 (sie enthalten eine PDF-Fassung); Import wie PDF. |
| LightBurn-Projekte (`.lbrn2`) | Formen, Bilder, Gruppen und Layer-Einstellungen. **Datei → Öffnen** erstellt ein neues Projekt, **Importieren** fügt ins aktuelle ein. |
| 3D-Modelle: STL, OBJ | Werden zu einem Schicht- oder Rippenmodell aus flachen Teilen. |

## Export

**Datei → Exportieren**, auch als Knöpfe in der Hauptleiste.

| Format | Hinweise |
|---|---|
| SVG | Aktuelle Seite, mit Bildern |
| DXF | Aktuelle Seite, ein DXF-Layer pro KizamuBeam-Layer, Kurven als exakte Splines. Bilder können nicht ins DXF. |
| PDF | Alle Seiten in Bettgröße 1:1, eine PDF-Ebene pro KizamuBeam-Layer, Bilder eingebettet |
| Adobe Illustrator (`.ai`) | Dieselbe PDF-kompatible Datei; öffnet in Illustrator, Inkscape und Affinity |
| G-Code (`.gcode`, `.nc`) | **Laser → G-Code speichern …** für das gewählte Gerät |
| PNG | **Bearbeitetes Bild speichern …**: ein Bild genau so, wie es gelasert würde |

Texte werden als Umrisse exportiert.

## Eigene Dateien von KizamuBeam

| Endung | Inhalt |
|---|---|
| `.kzb` | Projekt (ältere `.lwk`-Dateien öffnen weiter) |
| `.kzt` | Vorlage mit Parametern |
| `.kzm` | Materialbibliothek (ältere `.lwm`-Dateien und LightBurn-Bibliotheken `.clb` lassen sich importieren) |
| `.kza` | Bibliothekselement (Motiv, Bild, Gestaltungselement) |
| `.kzp` | Erweiterungspaket, siehe [Erweiterungen](../extensions/index.md) |
| `.kzb-camera` | Kamerakalibrierung |
