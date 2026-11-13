---
sidebar_position: 6
title: Objekte, Seiten und Projekte
description: Das Fenster Objekte, Ausblenden und Sperren, mehrseitige Projekte, Projekt-Tabs, Verlauf und Notizen.
---

# Objekte, Seiten und Projekte

## Das Fenster Objekte

Das Fenster **Objekte** (rechts unter den Layern; **Fenster → Objekte**) zeigt alle Objekte der aktuellen Seite als Baum: Seiten, Layer, Objekte und aufklappbare Gruppen, das vorderste Objekt oben.

- Ein Klick wählt ein Objekt aus, Shift oder Ctrl fügt weitere hinzu. Die Auswahl auf der Arbeitsfläche folgt.
- Ein Doppelklick auf einen Namen benennt ein Objekt oder einen Layer um.
- **Auge**: Objekt oder Layer ausblenden.
- **Schloss**: Das Objekt lässt sich auf der Arbeitsfläche nicht mehr auswählen.
- **Laser-Symbol**: **Nicht lasern**. Das Objekt bleibt sichtbar (blass gezeichnet, in der Liste durchgestrichen), wird aber nicht gelasert, nicht in den G-Code geschrieben und nicht geprüft. Praktisch für Teile, die schon geschnitten sind oder für später bleiben. In einer Layer-Zeile schaltet dasselbe Symbol die Ausgabe des ganzen Layers.
- Zeilen ziehen ändert die Reihenfolge, verschiebt Objekte auf einen anderen Layer oder ordnet Layer um.

Ein Rechtsklick öffnet ein Kontextmenü mit Umbenennen, Auf Auswahl zoomen, Ausblenden, Auf Layer verschieben, Auf Seite verschieben und den üblichen Bearbeitungsbefehlen. Ausgeblendete oder gesperrte Objekte lassen sich dort wieder einblenden und entsperren.

### Teile neben dem Bett parken

Mit **Absolute Koordinaten** als Startart wird alles, was ganz außerhalb des Arbeitsbereichs liegt, ohne Warnung übersprungen, solange etwas anderes auf dem Bett liegt. So kannst du Ersatzteile neben dem Bett aufbewahren. Teile, die nur teilweise hinausragen, werden weiterhin gemeldet.

## Seiten

Ein Projekt kann mehrere Seiten haben, etwa eine pro Material oder Platte. Die Seiten stehen oben im Fenster Objekte und im Menü **Seiten**; Bild↑ und Bild↓ wechseln zwischen ihnen.

- Jede Seite hat ihre eigenen Objekte; die Layer-Einstellungen gelten für das ganze Projekt.
- Zeichnen, Lasern und der Export als SVG, DXF oder G-Code betreffen die aktuelle Seite. PDF- und AI-Export enthalten alle Seiten.
- Seiten hinzufügen, duplizieren, umbenennen (Doppelklick), löschen und durch Ziehen umsortieren. Objekte auf eine Seitenzeile ziehen verschiebt sie dorthin, ebenso **Seiten → Auswahl auf nächste Seite**.

Verschachteln und Generatoren legen selbst neue Seiten an, wenn Teile nicht mehr passen.

## Projekt-Tabs

Mehrere Projekte können gleichzeitig offen sein, als Tabs über der Arbeitsfläche. Jeder Tab hat eigene Seiten, eigene Auswahl, Ansicht und eigenen Rückgängig-Verlauf.

- **Datei → Neu** (Ctrl+N) oder **+** öffnet einen leeren Tab. **Öffnen** und **Neu aus Vorlage** nutzen einen neuen Tab, außer der aktuelle ist leer.
- Ctrl+Tab und Ctrl+Shift+Tab wechseln die Tabs; Ziehen sortiert um; × oder ein Mittelklick schließt einen Tab.
- Ungespeicherte Änderungen sind mit • markiert.
- Kopieren und Einfügen funktioniert zwischen Tabs.

Alle offenen Tabs werden automatisch gesichert und sind nach einem Neustart wieder da.

## Speichern

**Datei → Speichern** (Ctrl+S) speichert das Projekt als `.kzb`-Datei. Bilder, Schnitteinstellungen, Seiten, Notizen und Parameter stecken darin, die Datei lässt sich also so weitergeben. Ältere `.lwk`-Dateien öffnen weiterhin.

## Verlauf

Das Fenster **Verlauf** (Tab neben Objekte) listet die letzten 200 Änderungen mit Namen und Uhrzeit. Ein Klick auf eine Zeile springt mehrere Schritte zurück oder vor. Rückgängig gemachte Schritte bleiben grau unter dem aktuellen Stand, bis eine neue Änderung sie verwirft.

## Projektnotizen

**Fenster → Notizen** bewahrt Notizen mit dem Projekt auf, in drei Feldern:

- **Material**: Art, Dicke, wo du es gekauft hast.
- **Einrichten**: Fokus, Bett, Ursprung, wie das Werkstück gehalten wird.
- **Bearbeitung**: Reihenfolge, Durchgänge, Nachbearbeitung, was du nächstes Mal ändern willst.

Die Notizen werden in der Projektdatei und in Vorlagen gespeichert.
