---
sidebar_position: 3
title: Boxen mit Fingerzinken
description: Offene oder geschlossene Boxen mit Fingerzinken, nach Innen- oder Außenmaß, mit Schnittfuge und Steckspiel, und Boxen mit Trennwänden.
---

# Boxen mit Fingerzinken

Beide Box-Generatoren stehen unter **Werkzeugkasten → Boxen und Möbel**. Für einen Deckel, der sich an einem Stift öffnet, setzt du danach ein [Deckelscharnier](../features/construction-3d.md#lid-hinge).

## Box mit Fingerzinken

| Feld | Bedeutung |
|---|---|
| **Maße** | **Außenmaß** oder **Innenmaß**: ob Breite, Tiefe und Höhe außen oder innen an den Wänden gemessen werden. |
| **Breite**, **Tiefe**, **Höhe** | Größe der Box in mm. |
| **Materialdicke** | Dicke der Platte. Miss nach; Platten sind selten genau so dick wie verkauft. |
| **Oben** | **Offen** oder **Geschlossen (Deckel mit Zinken)**. |
| **Zinkenbreite** | Mindestbreite der Zinken. Jede Kante bekommt eine ungerade Zahl gleich breiter Zinken. |
| **Steckspiel** | Jede Zinke wird um so viel schmaler; negativ = Presspassung. |
| **Schnittfuge (Kerf)** | Breite des Laserschnitts; Konturen werden um die Hälfte nach außen versetzt. |

Vorder- und Rückwand besitzen die Ecken. Die Teile sind eigene Objekte in einer kompakten Anordnung: Gleiche Teile bleiben beieinander. Ein Doppelklick auf irgendein Teil bearbeitet die ganze Box, auf allen Seiten. Teile, die noch in ihrer erzeugten Anordnung liegen, rücken beim Wachsen auseinander; Teile, die du selbst angeordnet hast, bleiben, wo sie sind.

### Gravur auf einer Wand

Lege Text oder Bilder auf eine Wand und gruppiere sie damit, oder lege sie einfach darauf: In der 3D-Ansicht erscheinen Gravuren auf der Wand, auf der sie liegen. Die Vorlage **beschriftete Box** (**Datei → Neu aus Vorlage …**) ist ein fertiges Beispiel mit Beschriftung auf der Vorderseite.

### Gute Passung

1. Miss die Materialdicke mit einem Messschieber an mehreren Stellen und gib den Mittelwert ein.
2. Beginne mit Steckspiel 0 und der Schnittfuge deines Lasers (0,1 bis 0,2 mm bei einem Diodenlaser auf Sperrholz).
3. Schneide die Box. Ist sie zu stramm, erhöhe das Spiel in Schritten von 0,05 mm; ist sie locker, verringere es.

Die [Passungs-Kalibrierung](../features/materials-tests.md#calibrate-fit) findet diese Werte für ein Material in einem Test, und neue Boxen übernehmen sie dann automatisch.

## Box mit Fingerzinken und Trennwänden

Eine offene oder geschlossene Box mit sich kreuzenden Trennwänden. Dieser Generator ist **experimentell**: Prüfe die Teile in der 3D-Ansicht und an einem Reststück, bevor du das richtige Material schneidest.

| Feld | Bedeutung |
|---|---|
| **Breite**, **Tiefe**, **Höhe**, **Materialdicke**, **Oben** | Wie bei der Box. |
| **Fächer in Breitenrichtung** / **Fächer in Tiefenrichtung** | Anzahl der Fächer in jeder Richtung. |
| **Verteilung in Breitenrichtung** / **Verteilung in Tiefenrichtung** | Lichte Fachgrößen als Verhältnisse oder in mm, durch Doppelpunkte getrennt. `1:2:1` macht das mittlere Fach doppelt so breit; `36mm:1` macht das erste 36 mm breit, das zweite bekommt den Rest. `+ - * /` und Klammern gehen auch. Leer = gleich große Fächer. |
| **Trennwände niedriger als Box** | Um wie viel die Trennwände niedriger als die Wände sind. |
| **Schnittfuge (Kerf)** | Breite des Laserschnitts. |

**Zinkenbreite** und **Steckspiel** stehen unter **Erweitert**. Teile und ihre Löcher liegen auf einem gemeinsamen Layer.
