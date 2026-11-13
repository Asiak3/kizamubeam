---
sidebar_position: 2
title: Die Oberfläche
description: Ein Rundgang durch das Hauptfenster von KizamuBeam, seine Leisten, Fenster und Menüs.
---

# Die Oberfläche

![KizamuBeam-Hauptfenster](/img/design-de.png)

## Das Hauptfenster im Überblick

| Bereich | Was du dort findest |
|---|---|
| **Menüleiste** (oben) | Datei, Bearbeiten, Werkzeuge, Anordnen, Seiten, Laser, Ansicht, Fenster und Hilfe. |
| **Hauptleiste** (unter dem Menü) | Neu, Öffnen, Speichern, Importieren und Exportieren, Rückgängig, Zwischenablage, Zoom, 3D-Ansicht, Kamera, Geräteeinstellungen, Konstruktion prüfen, Vorschau, Gruppieren, Spiegeln und Ausrichten. |
| **Eigenschaftenleiste** | Position, Größe und Drehung der Auswahl. Die Felder verstehen Formeln mit Einheiten, etwa `100/3` oder `2in`. Ist ein Text ausgewählt, erscheint die Textleiste mit Schrift, Höhe und Abständen. |
| **Werkzeugleiste** (links) | Auswählen und Knoten bearbeiten, Linien, Kurven, Rechtecke, Ellipsen, Polygone und Text zeichnen, QR-Codes, der **Werkzeugkasten** mit allen Generatoren, boolesche Operationen, Versatz, Arrays, Verschachteln und Messen. |
| **Projekt-Tabs** (über der Arbeitsfläche) | Mehrere Projekte gleichzeitig, jedes mit eigenen Seiten, eigener Auswahl und eigenem Rückgängig-Verlauf. |
| **Arbeitsfläche** (Mitte) | Das Laserbett des gewählten Geräts. Hilfslinien ziehst du aus den Linealen. |
| **Fenster** (rechts) | Schnitte / Layer, Objekte und Verlauf; unten rechts Laser, Verschieben und Konsole. |
| **Palette** (unten) | Eine Farbe pro Layer. Ein Klick auf eine Farbe legt die Auswahl auf diesen Layer. |
| **Statusleiste** (unten) | Zeigerposition, Fangen („Fang“) und Raster. |

Die Fenster lassen sich verschieben, andocken, als Tabs gruppieren und ausblenden. Das Menü **Fenster** blendet sie ein und aus, und die Leisten lassen sich anpassen.

## Die Farbe ist der Layer

Jedes Objekt gehört zu einem Layer, und jeder Layer hat eine Farbe. Der Layer bestimmt, **wie** das Objekt gelasert wird: Modus (Linie oder Füllen), Geschwindigkeit, Leistung, Durchgänge und mehr. Objekte haben nie eigene Lasereinstellungen; soll etwas anders gelasert werden, kommt es auf einen anderen Layer.

Ein Doppelklick auf einen Layer im Fenster Schnitte / Layer öffnet seine Schnitteinstellungen.

## Auswählen und verschieben

- Ein Klick wählt ein Objekt aus, Shift+Klick fügt es zur Auswahl hinzu.
- Ein Auswahlrahmen nach **rechts** wählt Objekte, die ganz darin liegen, ein Rahmen nach **links** auch Objekte, die er nur berührt.
- Ein zweiter Klick auf ein ausgewähltes Objekt wechselt zwischen Skalieren und Drehen.
- Die Pfeiltasten verschieben die Auswahl um 1 mm (Shift 10 mm, Alt 0,1 mm).
- Leertaste + Ziehen, die mittlere Maustaste oder das Mausrad verschieben und zoomen die Ansicht.

Alle Tastenkürzel findest du unter [Tastenkürzel](../reference/keyboard-shortcuts.md) und in der App mit **F1**.

## Sprache und Design

- **Ansicht → Sprache**: Deutsch, Englisch, Italienisch und weitere. Standard ist die Systemsprache.
- **Ansicht → Design** oder der Knopf ganz rechts in der Hauptleiste: hell oder dunkel. Standard ist die Systemeinstellung.

## Einstellungen

**Bearbeiten → Einstellungen …** fasst alle Programmeinstellungen in einem Fenster mit Suchfeld zusammen: Allgemein, Darstellung, Arbeitsfläche und Fangen, Maus und Tastatur, Maschinen und Dienste, Erweiterungen und Schriften.
