---
sidebar_position: 3
title: Funktionen und Werkzeuge
description: Überblick über das, was KizamuBeam kann, vom Zeichnen bis zur Maschinensteuerung.
---

# Funktionen und Werkzeuge

Dieses Kapitel bekommt eine Seite pro Thema. Bis diese Seiten geschrieben sind, fasst jeder Abschnitt unten das Thema zusammen und verweist auf den passenden Teil der [vollständigen Funktionsliste](https://github.com/negurvulkan/kizamubeam/blob/main/docs/features.de.md), die jede Funktion mit ihrem Menüpfad beschreibt.

## Zeichnen und Bearbeiten

Linien und Bézierkurven, Rechtecke mit Eckenradius, Ellipsen, Polygone, Sterne und Text in jeder Schrift. Formen mit booleschen Operationen kombinieren, versetzen, Knoten bearbeiten (auch über mehrere Objekte), Pfade vereinfachen und glätten, Text auf einen Pfad legen und Ecken runden. Fangen, Hilfslinien, Beziehungen wie konzentrisch oder parallel und Skizzen mit Bemaßung halten Entwürfe exakt.
→ [Zeichnen und Bearbeiten](https://github.com/negurvulkan/kizamubeam/blob/main/docs/features.de.md#zeichnen-und-bearbeiten), [Text, Formen und Pfade](https://github.com/negurvulkan/kizamubeam/blob/main/docs/features.de.md#text-formen-und-pfade)

## Layer und Objekte

Die Farbe eines Objekts ist sein Layer, und der Layer enthält alle Lasereinstellungen: Modus, Geschwindigkeit, Leistung, Durchgänge, Füllung, Schnittbreitenausgleich, Haltestege und mehr. Das Fenster Objekte zeigt alle Objekte je Layer, mit Sichtbarkeit, Sperre und „nicht lasern“. Projekte können mehrere Seiten haben.
→ [Layer, Material und Tests](https://github.com/negurvulkan/kizamubeam/blob/main/docs/features.de.md#layer-material-und-tests), [Projekte und Seiten](https://github.com/negurvulkan/kizamubeam/blob/main/docs/features.de.md#projekte-und-seiten)

## Import und Export

SVG-, DXF-, PDF- und Illustrator-Dateien, LightBurn-Projekte (`.lbrn2`) und alle gängigen Bildformate öffnen. Fotos bekommen Rasterung und andere Bildmodi, Hintergrund entfernen, Zuschneiden und Masken, und lassen sich in Vektoren nachzeichnen. Export als SVG, DXF, PDF, Illustrator und G-Code. Siehe auch [Dateiformate](../reference/file-formats.md).
→ [Import, Bilder und Nachzeichnen](https://github.com/negurvulkan/kizamubeam/blob/main/docs/features.de.md#import-bilder-und-nachzeichnen)

## Verschachteln

**Anordnen → Verschachteln …** ordnet Teile nach ihren echten Umrissen an und spart Material, auf dem Arbeitsbereich, auf einer Materialgröße oder in einem Reststück. Kleine Teile können in Löcher großer Teile wandern.
→ [Zeichnen und Bearbeiten](https://github.com/negurvulkan/kizamubeam/blob/main/docs/features.de.md#zeichnen-und-bearbeiten)

## 3D-Ansicht und Konstruktion

**Fenster → 3D-Ansicht** zeigt Boxen, Schubladen, Regale und Zahnradpaare zusammengebaut, mit Material und Gravuren, und markiert Teile, die sich überschneiden. Verbindungen, Schlitze und Biegeschnitte lassen sich an jede Form anbringen, und aus 3D-Modellen (STL/OBJ) werden Schicht-, Rippen- oder Scheibenmodelle. Siehe auch [Generatoren](../generators/index.md).
→ [Verbindungen, Generatoren und 3D](https://github.com/negurvulkan/kizamubeam/blob/main/docs/features.de.md#verbindungen-generatoren-und-3d)

## Material und Maschinenprofile

Die Materialbibliothek speichert bewährte Einstellungen je Material und Stärke. Materialtest, Fokustest und Passungskalibrierung helfen, sie zu finden. Jeder Laser ist ein Gerät mit eigenem Arbeitsbereich, eigener Verbindung und eigenen Einstellungen, angelegt aus Vorlagen für verbreitete Laser.
→ [Layer, Material und Tests](https://github.com/negurvulkan/kizamubeam/blob/main/docs/features.de.md#layer-material-und-tests), [Laser und Maschine](https://github.com/negurvulkan/kizamubeam/blob/main/docs/features.de.md#laser-und-maschine)

## G-Code und Maschinensteuerung

Per USB oder WLAN verbinden, Rahmen fahren, starten, pausieren und Leistung und Geschwindigkeit während des Laserns anpassen, ab jeder Stelle des Jobs starten. Vor jedem Job prüft KizamuBeam, ob er aufs Bett passt. Drehachsen, motorisierte Z-Achse und Air Assist werden unterstützt. Siehe [Laser verbinden](../getting-started/connect-laser.md).
→ [Laser und Maschine](https://github.com/negurvulkan/kizamubeam/blob/main/docs/features.de.md#laser-und-maschine)

## Virtuelle Maschine

Die KizamuBeam Virtual Machine ist ein eigenes Programm, das sich wie ein FluidNC- oder GRBL-Laser verhält. Sie zeigt den Job in 3D, brennt ihn in virtuelles Material und hat eine virtuelle Kamera, sodass du Jobs, Kamerafunktionen und Print and Cut ohne Hardware ausprobieren kannst.
→ [Laser und Maschine](https://github.com/negurvulkan/kizamubeam/blob/main/docs/features.de.md#laser-und-maschine)
