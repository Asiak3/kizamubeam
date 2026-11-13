---
sidebar_position: 1
title: Zeichnen und bearbeiten
description: Linien, Kurven, Formen und Freihandstriche zeichnen, Objekte auswählen und transformieren und Knoten bearbeiten.
---

# Zeichnen und bearbeiten

Alles, was du in KizamuBeam zeichnest, ist eine bearbeitbare Vektorform. Diese Seite beschreibt die Zeichenwerkzeuge, das Auswählen und Transformieren und die Knotenbearbeitung. Wie du Pfade kombinierst und umformst, steht unter [Pfade und Formen](paths.md), genaues Platzieren unter [Fangen, Hilfslinien und Messen](precision.md).

## Zeichenwerkzeuge

Die Zeichenwerkzeuge liegen in der Werkzeugleiste links und im Menü **Werkzeuge**.

| Werkzeug | Kürzel | So geht's |
|---|---|---|
| **Linien zeichnen** | Ctrl+L | Klicken setzt Ecken, Klicken und Ziehen erzeugt eine Bézierkurve. Ein Klick auf den Startpunkt schließt die Form; Doppelklick, Enter oder Rechtsklick beendet. |
| **Freihand / Bleistift** | | Einen Strich ziehen; beim Loslassen wird er in glatte, bearbeitbare Kurven umgerechnet. In den Werkzeugoptionen stellst du die Toleranz ein und ob der Strich geschlossen wird. |
| **Rechteck** | Ctrl+R | Ein Rechteck aufziehen. Shift zeichnet ein Quadrat, Ctrl von der Mitte aus. Den Eckenradius stellst du in der Eigenschaftenleiste ein. |
| **Ellipse** | Ctrl+E | Eine Ellipse aufziehen. Shift zeichnet einen Kreis, Ctrl von der Mitte aus. |
| **Polygon** | | Von der Mitte aus ziehen. Eckenzahl und **Stern** in der Eigenschaftenleiste. |
| **Text** | Ctrl+T | Siehe [Text und Codes](text.md). |

Rechtecke, Ellipsen, Polygone und Texte bleiben als solche bearbeitbar: Eckenradius, Eckenzahl oder Text lassen sich später ändern. **In Pfad umwandeln** (Ctrl+Shift+C) macht gewöhnliche Pfade daraus.

## Auswählen

- **Klick** wählt ein Objekt aus, **Shift+Klick** fügt eines hinzu oder nimmt es heraus.
- Ein **Rahmen nach rechts** wählt Objekte, die ganz darin liegen, ein **Rahmen nach links** auch solche, die er nur schneidet.
- **Lasso-Auswahl** (**Werkzeuge → Pfad**): um Objekte herumzeichnen, um die vollständig umschlossenen auszuwählen. Shift ergänzt, Ctrl schaltet um.
- **Ctrl+A** wählt alles auf der aktuellen Seite, **Esc** hebt die Auswahl auf.
- Ein Rechtsklick öffnet ein Kontextmenü mit den Befehlen, die zu dem passen, was unter dem Zeiger liegt: Formen, Bilder, Knoten oder leere Arbeitsfläche.

Liegen viele Objekte übereinander, hilft **Werkzeuge → Auswahl isolieren**: Nur die ausgewählten Objekte lassen sich anklicken und fangen, alles andere bleibt sichtbar, aber unerreichbar. Ein Hinweis oben zeigt, dass die Isolation aktiv ist. Auf den Job wirkt sie sich nicht aus; gelasert wird weiterhin alles. Beenden mit **Isolation verlassen** oder Esc.

## Verschieben, skalieren und drehen

- Eine Auswahl ziehen, um sie zu verschieben. Die Pfeiltasten verschieben um 1 mm (Shift 10 mm, Alt 0,1 mm).
- Einen Griff ziehen, um zu skalieren. Shift wechselt zwischen proportionalem und freiem Skalieren, Ctrl skaliert von der Mitte aus.
- **Die Auswahl ein zweites Mal anklicken** (oder knapp außerhalb einer Ecke ziehen), um zu drehen. Der Drehpunkt lässt sich verschieben. Shift rastet auf 15° ein, Ctrl auf 5°, Esc bricht ab.
- `.` und `,` drehen um 90°. **Ctrl+Shift+H** und **Ctrl+Shift+V** spiegeln.

### Genaue Werte

Die **Eigenschaftenleiste** oben zeigt Position, Größe und Drehung der Auswahl. Ein 9-Punkt-Anker legt fest, auf welchen Punkt sich die Werte beziehen. Die Felder verstehen Formeln und Einheiten, etwa `100/3`, `2in` oder `25.4*3`, und Projektparameter wie `{Breite}/2` (siehe [Vorlagen und Bibliothek](templates-library.md)).

## Gruppieren, ausrichten und anordnen

- **Ctrl+G** gruppiert, **Ctrl+U** hebt die Gruppierung auf.
- Bei mehreren ausgewählten Objekten richten **L R T B** links, rechts, oben und unten aus, **C** und **E** die Mitten. Die Ausrichten-Gruppe in der Hauptleiste verteilt Objekte auch gleichmäßig.
- **Anordnen → Reihenfolge** holt Objekte nach vorn oder schickt sie nach hinten.
- Arrays, Verschachteln und Musterfüllungen stehen unter [Anordnen und vervielfältigen](arranging.md).

## Knoten bearbeiten

Mit **Knoten bearbeiten** (Ctrl+`) änderst du die Form von Pfaden. Sind mehrere Pfade oder Formen ausgewählt, lassen sich die Knoten aller zusammen bearbeiten.

| Aktion | So geht's |
|---|---|
| Knoten auswählen | Klick, Shift+Klick, Rahmen (oder **Knoten-Lasso**) oder Ctrl+A |
| Knoten verschieben | Ziehen oder mit den Pfeiltasten schieben |
| Knoten löschen | D oder Entf |
| Knoten einfügen | I oder Doppelklick auf ein Segment |
| Segment als Gerade / Kurve | L / C |
| Knoten als Ecke / glatt | E / S |
| Pfad am Knoten aufbrechen | B |
| Kante bis zu den Schnittpunkten trimmen | T |

Wird ein Segment gelöscht, teilt sich der Pfad dort. Jede Aktion ist ein Rückgängig-Schritt.

## Rückgängig und Verlauf

**Ctrl+Z** macht rückgängig, **Ctrl+Y** (oder Ctrl+Shift+Z) wiederholt. Das Fenster **Verlauf** (neben Objekte) listet die letzten 200 Änderungen mit Namen wie „Verschieben“ oder „Offset“; ein Klick auf eine Zeile springt mehrere Schritte auf einmal zurück oder vor.
