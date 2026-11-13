---
sidebar_position: 5
title: Layer und Schnitteinstellungen
description: Wie Layer funktionieren, die Modi Linie und Füllen und jede Schnitteinstellung von Durchgängen über Stege bis zu Anschnitten und Sub-Layern.
---

# Layer und Schnitteinstellungen

## Die Farbe ist der Layer

Jedes Objekt gehört zu einem Layer, und jeder Layer hat eine Farbe aus der Palette unten (00–29 sowie die Werkzeug-Layer T1 und T2). Ein Klick auf eine Farbe der Palette legt die Auswahl auf diesen Layer.

Der Layer enthält **alle Lasereinstellungen**. Objekte, auch Bilder, haben nie eine eigene Geschwindigkeit oder Leistung: Soll etwas anders gelasert werden, kommt es auf einen anderen Layer. So ist ein Layer ein Arbeitsgang des Jobs, und für alles darauf gelten dieselben Einstellungen.

Das Fenster **Schnitte / Layer** listet die verwendeten Layer mit Modus, Geschwindigkeit, Leistung, Air Assist und Ausgabe. Die Werte lassen sich direkt in der Tabelle ändern; durch Ziehen der Zeilen änderst du die Reihenfolge, in der die Layer gelasert werden.

## Modi

| Modus | Was passiert |
|---|---|
| **Linie** | Der Laser fährt die Konturen ab: Schneiden und Ritzen. |
| **Füllen** | Geschlossene Formen werden Zeile für Zeile graviert (oder in Ringen beim konturfolgenden Füllen). Offene Linien werden übersprungen. |

Bilder können auf jedem Layer liegen. Die Tabelle zeigt dann „+ Bild“, und der Layer-Dialog bekommt einen Abschnitt **Bild** mit Zeilenabstand und Bildeinstellungen. Jedes Bild behält seinen eigenen Bildmodus (siehe [Bilder und Nachzeichnen](images.md)); Geschwindigkeit und Leistung kommen vom Layer.

## Werkzeug-Layer T1 und T2

T1 und T2 werden nie gelasert. Nutze sie für Konstruktionslinien, den Umriss eines Werkstücks, Kamerabilder zum Nachzeichnen oder den Pfad eines Textes auf Pfad, der nicht geschnitten werden soll.

## Ausgabe und Sichtbarkeit

- **Ausgabe** entscheidet, ob ein Layer überhaupt gelasert wird. Ausgeblendete Layer und Objekte werden trotzdem gelasert, wenn ihre Ausgabe an ist; KizamuBeam weist dich vor dem Job darauf hin.
- Im [Fenster Objekte](objects-pages.md) lassen sich einzelne Objekte auf **Nicht lasern** setzen: Sie bleiben (blass) sichtbar, werden aber nicht gelasert, nicht in den G-Code geschrieben und nicht geprüft.

## Schnitteinstellungen

Ein Doppelklick auf einen Layer öffnet seine **Layer-Einstellungen**. Welche Felder erscheinen, hängt vom Modus ab.

### Für alle Modi

| Einstellung | Bedeutung |
|---|---|
| **Geschwindigkeit (mm/min)** | Vorschub bei eingeschaltetem Laser. |
| **Max. Leistung (%)** / **Min. Leistung (%)** | Die Leistung des Layers. Min. Leistung gilt, wo die Leistung abgesenkt wird: bei Leistungsrampen und für die hellsten Töne von Graustufenbildern. |
| **Durchgänge** | Wie oft der Layer wiederholt wird. |
| **Air Assist** | Schaltet die Luftunterstützung (M8 oder M7) für diesen Layer ein. |
| **Z-Versatz (mm)** und **Je Durchgang tiefer (mm)** | Nur mit motorisierter Z-Achse: den Fokus gegenüber der Starthöhe verschieben und mit jedem Durchgang tiefer gehen. |
| **Material** | Verknüpft den Layer mit einem Eintrag der Material-Bibliothek; wird auch von der 3D-Ansicht und der Passungs-Kalibrierung genutzt. |

### Linie

| Einstellung | Bedeutung |
|---|---|
| **Kerf-Versatz (mm)** | Verschiebt den Schnitt bei Außenkonturen nach außen und bei Löchern nach innen, damit Teile ihr Nennmaß behalten. Meist die halbe Schnittbreite. |
| **Stege** | Lässt kleine Brücken stehen, damit Teile nicht herausfallen: Anzahl je Form oder Abstand, Stegbreite, wahlweise ohne Innenformen. |
| **Perforation** | Schneidet eine bestimmte Länge und lässt dann eine Lücke, für Abreißkanten oder Falzlinien. |
| **Anschnitt / Auslauf** | Eine schräge Gerade oder ein Bogen in die Kontur hinein und aus ihr heraus, immer auf der Abfallseite, damit der Startpunkt keine Spur am Teil hinterlässt. |
| **Überschnitt (mm)** | Fährt über den Startpunkt hinaus, damit die Kontur sicher geschlossen ist. |
| **Leistungsrampe** | Senkt die Leistung zu Ecken hin (ab einer einstellbaren Richtungsänderung), um Brandflecken zu vermeiden, wahlweise auch am Anfang und Ende jedes Schnitts. |
| **Doppelte Linien** | Entfernt übereinanderliegende Linien vor dem Schneiden, damit nichts doppelt geschnitten wird. |

### Füllen

| Einstellung | Bedeutung |
|---|---|
| **Zeilenabstand (mm)** oder **Zeilen pro Zoll** | Abstand der Füll-Linien. |
| **Scanwinkel (°)** | Richtung der Linien: 0° waagerecht, 90° senkrecht. |
| **Kreuzschraffur** | Ein zweiter, um 90° gedrehter Durchgang. |
| **Bidirektional** | Lasert in beide Richtungen (schneller). |
| **Überfahrweg (%)** | Fährt mit ausgeschaltetem Laser über die Ränder hinaus, damit der Kopf beim Einschalten volle Geschwindigkeit hat. Vermeidet dunklere Ränder. |
| **Füllart** | **Zeilenweise** oder **Kontur folgend**: Ringe, die der Kontur nach innen folgen. |

**Standardwerte** setzt die Felder auf die Vorgaben des gewählten Modus zurück.

## Sub-Layer

**+ Sub-Layer** fügt weitere Arbeitsgänge auf denselben Formen hinzu, jeder mit eigenem Modus, eigener Geschwindigkeit, Leistung, Durchgängen und Einstellungen. Klassisch ist „erst füllen, dann die Kontur schneiden“ auf einem einzigen Layer. Sub-Layer laufen nach dem Layer selbst und lassen sich einzeln abschalten.

## Aussehen in 3D

**Aussehen in 3D** legt fest, wie die Teile des Layers in der [3D-Ansicht](construction-3d.md) aussehen: 21 Materialien von Sperrholz über Schiefer und Acryl bis eloxiertem Aluminium, jeweils mit optionaler eigener Farbe.

## Material-Bibliothek

Das Fenster **Material** speichert bewährte Einstellungen je Material und Dicke und überträgt sie mit einem Klick auf einen Layer. Siehe [Materialien und Tests](materials-tests.md).
