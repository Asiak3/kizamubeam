---
sidebar_position: 4
title: Text und Codes
description: Text in jeder Schrift setzen, Text auf einen Pfad legen, variablen Text und Seriennummern nutzen und QR-Codes und Strichcodes erzeugen.
---

# Text und Codes

## Text schreiben

Wähle das Werkzeug **Text** (Ctrl+T) und klicke auf die Arbeitsfläche, um zu schreiben. Ziehst du statt zu klicken einen Rahmen auf, entsteht ein Textrahmen mit Zeilenumbruch. Ein Klick auf einen vorhandenen Text bearbeitet ihn.

Die **Textleiste** unter der Eigenschaftenleiste enthält alle Textoptionen: Schrift, Höhe, fett, kursiv, Großbuchstaben, Zeichen- und Zeilenabstand, Ausrichtung, maximale Breite und Höhe, Vereinen, Text auf Pfad und variablen Text.

| Option | Wirkung |
|---|---|
| **Vereinen** | Verschmilzt überlappende Buchstaben zu einer Kontur, für Schreibschriften oder engen Zeichenabstand. |
| **Umbrechen** / **Max. Breite** | Bricht Zeilen an Wortgrenzen bei der Rahmenbreite um; der Rahmen wächst nach unten. Ziehen an den seitlichen Griffen bricht den Text neu um. |
| **Max. Höhe** | Verkleinert einen zu hohen Block gleichmäßig. |
| **Verkleinern** | Verkleinert einen zu breiten Text, statt ihn zu stauchen. |

Text bleibt bearbeitbar. **In Pfad umwandeln** (Ctrl+Shift+C) macht daraus die echten Umrisse der Schrift, etwa vor dem Bearbeiten der Knoten.

## Schriften

Alle auf deinem Rechner installierten Schriften lassen sich verwenden. **Datei → Schriften …** (oder **Weitere Schriften …** am Ende der Schriftliste) öffnet den Schriften-Manager:

- Alle Google Fonts durchsuchen, mit Live-Vorschau deines eigenen Beispieltexts, nach Art filtern und nach Beliebtheit oder Name sortieren.
- **Installieren** lädt die Schrift in KizamuBeam herunter, sodass sie offline und ohne Installation im System funktioniert. **Verwenden** wendet sie auf den ausgewählten Text an.
- Eigene TTF- oder OTF-Dateien importierst du genauso.
- Mit dem Stern wird eine Schrift zum Favoriten; Favoriten stehen oben in der Schriftliste.

Nutzt ein Projekt eine Schrift, die auf diesem Rechner fehlt, bietet KizamuBeam an, sie von Google Fonts zu laden.

## Text auf einem Pfad

Wähle einen Text und eine Form aus und dann **Werkzeuge → Textfunktionen → Text auf Pfad** (oder **Auf Pfad** in der Textleiste). Der Text folgt der Linie, Kurve, dem Rechteck, der Ellipse oder dem Polygon. In der Textleiste stellst du den Versatz entlang der Kurve, den Abstand zur Kurve und die Seite ein, auf der der Text steht.

Text und Form bleiben verbunden: Bearbeitest oder verschiebst du die Form, folgt der Text. Die Form wird mitgelasert, außer sie liegt auf einem Werkzeug-Layer (T1/T2) oder ist ausgeblendet. **Werkzeuge → Textfunktionen → Text vom Pfad lösen** trennt beide wieder.

## Variabler Text und Seriennummern

Variabler Text füllt Platzhalter beim Erzeugen des Jobs aus, für Seriennummern, Datum oder Namen aus einer Liste. Schalte in der Textleiste **Variabel** ein und nutze diese Platzhalter:

| Platzhalter | Wird zu |
|---|---|
| `%#` | Seriennummer; `%4#` mit führenden Nullen (`0042`) |
| `%d.%m.%Y`, `%H:%M` … | Datum und Uhrzeit |
| `%0`, `%1` … oder `%{Spaltenkopf}` | Spalte einer CSV-Datei (getrennt durch Komma, Semikolon oder Tab) |

Das Fenster **Variabler Text** (**Werkzeuge → Textfunktionen → Variabler Text …**) legt die aktuelle Nummer, Start, Ende, Schrittweite und das automatische Weiterzählen nach jedem Job oder gespeicherten G-Code fest. Die Nummer ist auch die Zeile der CSV-Datei. Jedes Objekt kann einen eigenen Versatz haben, so passen mehrere aufeinanderfolgende Nummern auf eine Seite.

**Variablen Text festschreiben** macht aus dem aktuellen Inhalt festen Text.

Für eine ganze Serie von Seiten aus einer Tabelle siehe [Vorlagen und Bibliothek](templates-library.md#series-from-a-table).

## QR-Codes

Klicke auf die QR-Schaltfläche in der Werkzeugleiste (oder suche sie im Werkzeugkasten). Ein QR-Code kann enthalten:

- Text oder eine Webadresse,
- WLAN-Zugangsdaten,
- eine Visitenkarte (vCard).

Wähle die Fehlerkorrektur (L, M, Q, H) und die Größe in mm. **Negativ** lasert den Hintergrund samt Ruhezone, für dunkle Materialien. Die Module werden zu geschlossenen Konturen verschmolzen; lege den Code also auf einen Layer mit **Füllen**, um ihn zu gravieren. Ein Doppelklick auf einen QR-Code bearbeitet ihn.

## Strichcodes

**Werkzeugkasten → Text und Daten → Strichcode** erzeugt Code 128, EAN-13, EAN-8, UPC-A, Code 39 und ITF, mit Prüfziffer, wo das Format eine hat. Stelle Breite und Balkenhöhe ein, zeige den Klartext unter den Balken und verringere die Balkenbreite, um die Strahlbreite auszugleichen. **Negativ** lasert die Lücken statt der Balken. Der Dialog warnt, wenn Balken für den Laser zu schmal werden.

QR-Codes und Strichcodes verstehen auch variablen Text und Projektparameter, etwa eine Seriennummer als Code 128.
