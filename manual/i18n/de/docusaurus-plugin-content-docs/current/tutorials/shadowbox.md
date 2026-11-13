---
sidebar_position: 4
title: Eine Shadowbox aus Schichten
description: Eine Landschafts-Shadowbox aus mehreren geschnittenen Schichten mit Motiven aus der Bibliothek bauen, die Tiefe in 3D prüfen und verleimen.
---

# Eine Shadowbox aus Schichten

Eine Shadowbox ist ein Bild aus mehreren gestapelten Schichten mit Ausschnitten, sodass die Szene Tiefe bekommt. In diesem Tutorial baust du eine kleine Landschaft aus fünf Schichten: Rückwand, Himmel mit Mond, Berge, Bäume und ein vorderer Rahmen.

**Du brauchst:** fünf Stücke 3-mm-Sperrholz oder dicken Karton, je etwa 150 × 150 mm, und Holzleim. Farbiger Karton oder bemalte Schichten sehen besonders gut aus.

## 1. Die Schichten planen

Jede Schicht hat denselben Außenrahmen, damit der Stapel bündig bleibt. Von hinten nach vorn:

| Schicht | Inhalt |
|---|---|
| 1 | Rückwand, geschlossen |
| 2 | Himmel: ein Rahmen mit ausgeschnittenem runden Mond |
| 3 | Berge |
| 4 | Bäume |
| 5 | Vorderer Rahmen |

## 2. Den Rahmen zeichnen

1. Zeichne ein Quadrat von 150 × 150 mm (Rechteck-Werkzeug, Ctrl+R, dann die Größe in der Eigenschaftenleiste eingeben).
2. Zeichne ein zweites Quadrat von 130 × 130 mm und zentriere es auf dem ersten (**C** und **E**).
3. Kopiere zuerst das äußere Quadrat (Ctrl+C, Ctrl+V) und schieb die Kopie zur Seite: Sie wird die Rückwand.
4. Wähle beide Quadrate des Rahmens aus und dann **Abziehen** (**Werkzeuge → Boolesche Operationen**). Jetzt hast du einen Rahmen.

## 3. Die Schichten aufbauen

Kopiere den Rahmen für die Schichten 2 bis 5 (Ctrl+C, Ctrl+V) und leg die Kopien nebeneinander.

1. **Himmel**: Zeichne ein Quadrat, das die Öffnung füllt und den Rahmen überlappt, und darauf einen Kreis für den Mond. Zieh den Kreis mit **Abziehen** ab und **vereine** das Ergebnis dann mit dem Rahmen.
2. **Berge**: Zeichne mit dem Werkzeug **Linien zeichnen** (Ctrl+L) eine Bergkette quer durch die Öffnung, schließe sie entlang der Unterkante des Rahmens und **vereine** sie mit dem Rahmen.
3. **Bäume**: Öffne **Fenster → Bibliothek**, such nach „Baum“ und zieh ein paar Bäume auf die Arbeitsfläche. Stell sie auf einen Hügel, den du entlang der Unterkante zeichnest, und **vereine** alles mit dem Rahmen.
4. **Vorderer Rahmen**: der Rahmen allein, oder mit ein paar Zweigen aus der Bibliothek, die in die Öffnung hängen.

Halte jede Schicht als eine geschlossene Kontur: Prüfe, ob Teile, die zusammenhalten sollen, den Rahmen wirklich berühren. Lose Inseln würden herausfallen.

## 4. Stapeln

1. Wähle alle fünf Schichten aus.
2. Wähle **Werkzeugkasten → 3D-Steckmodelle → Mehrlagenarbeit**.
3. Ordne die Schichten von unten nach oben: zuerst die Rückwand, zuletzt den vorderen Rahmen. Gib jeder einen Namen und eine Dicke von 3 mm.
4. Klicke auf **Erstellen**.

Öffne **Fenster → 3D-Ansicht**. Die Schichten liegen bündig gestapelt, und du kannst die Ansicht drehen, um die Tiefe zu beurteilen. Verdeckt eine Schicht zu viel von der dahinter, ändere die Formen und sieh erneut nach. Um Reihenfolge oder Dicke später zu ändern, wähle die Schichten aus und starte **Mehrlagenarbeit** erneut. Mehr unter [Mehrlagenarbeit](../generators/multilayer.md).

## 5. Schneiden und verleimen

1. Leg alle Konturen auf einen Schnitt-Layer und starte **Laser → Konstruktion prüfen**: Es findet offene Konturen und zu kleine Teile.
2. Schneide die Schichten. Feine Details wie Zweige brauchen eine geringere Geschwindigkeit oder einen zusätzlichen Durchgang, um sauber durchzuschneiden.
3. Bemale oder färbe die Schichten, wenn du magst, vor dem Verleimen.
4. Verleime den Stapel von hinten nach vorn und drück dabei die Außenrahmen bündig zusammen. Spanne oder beschwere ihn, während der Leim trocknet.

## Ideen

- Ein LED-Streifen zwischen Rückwand und Himmel macht daraus ein Nachtlicht.
- Graviere vor dem Schneiden Sterne mit einem Füll-Layer auf die Rückwand.
- Für ein Relief aus einem 3D-Modell statt aus deiner Zeichnung nimmst du das [Schichtmodell](../generators/models-3d.md).
