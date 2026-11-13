---
sidebar_position: 3
title: Fangen, Hilfslinien und Messen
description: An Knoten und Raster fangen, Hilfslinien nutzen, messen, Beziehungen anwenden und bemaßte Skizzen zeichnen.
---

# Fangen, Hilfslinien und Messen

## Fangen

**Fang** in der Statusleiste schaltet das Fangen ein und aus. Objekte und Zeiger fangen an Knoten, Mittelpunkten von Kanten, Zentren, Schnittpunkten, Linien und Quadrantenpunkten von Kreisen. **Raster** in der Statusleiste fängt am Raster.

- **Ctrl** beim Ziehen schaltet das Fangen vorübergehend aus (oder ein).
- **Alt** beim Ziehen fängt stärker und zeigt Ausrichtungshilfen an anderen Objekten.

Kreise und Bögen werden auch innerhalb von Pfaden erkannt, etwa Löcher in einer Platte oder importierte DXF-Kreise, sodass ihr echter Mittelpunkt fängt. **Ansicht → Mittelpunkte zeigen** zeigt Mittelpunktkreuze immer, nur für die Auswahl oder gar nicht.

## Raster

**Ansicht → Raster** blendet das Raster ein und aus. Unter **Gitter einstellen …** legst du den Abstand fest (z. B. 25,4 für Zoll), Unterteilungen, jede n-te Linie fett, Farbe und Deckkraft, und wahlweise wird der feinste Abstand zum Fangraster.

## Hilfslinien

Ziehe eine Hilfslinie aus dem oberen Lineal (waagerecht) oder dem linken Lineal (senkrecht). Hilfslinien liegen auf einer eigenen Ebene **Hilfslinien**: Sie werden nie gelasert oder exportiert, und Ctrl+A, die Palette und Formoperationen lassen sie in Ruhe. Ziehe eine Hilfslinie, um sie zu verschieben, oder zurück ins Lineal, um sie zu löschen. Die Ebene Hilfslinien lässt sich im Fenster Objekte ausblenden und sperren. Hilfslinien gelten für alle Seiten.

## Messen

**Werkzeuge → Messen** (oder die Lineal-Schaltfläche): Anfangs- und Endpunkt anklicken, mit Fang. KizamuBeam zeigt Länge, Δx, Δy und Winkel, über einem Kreis Durchmesser und Radius. Esc löscht die Messung.

## Beziehungen

**Anordnen → Beziehungen** (oder die Beziehungs-Gruppe in der Werkzeugleiste) verschiebt oder dreht ein Objekt so, dass es in einer Beziehung zu einem anderen steht. Klicke zuerst das Bezugselement an (es bleibt stehen), dann das Element des Objekts, das sich anpassen soll.

| Beziehung | Wirkung |
|---|---|
| **Konzentrisch** | Zwei Kreise, Ellipsen oder Polygone bekommen einen gemeinsamen Mittelpunkt (auch Löcher in Pfaden). |
| **Gleich groß** | Gleicher Radius für zwei Kreise, gleiche Länge für zwei Kanten. |
| **Parallel** / **Senkrecht** | Das zweite Objekt dreht sich um den kleinsten Winkel. |
| **Waagerecht** / **Senkrecht** | Richtet eine Kante waagerecht oder senkrecht aus. |
| **Tangential** | Das zweite Objekt rückt heran, bis es berührt. |
| **Abstand** | Fragt nach einem Abstand zwischen Kanten, Punkten oder Kreisen. |

Beziehungen werden einmalig angewendet, wie ein Befehl; jede ist ein Rückgängig-Schritt.

## Skizzen mit Bemaßung {#sketches-with-dimensions}

Für Teile, die beim Ändern ihre genauen Maße behalten sollen, gibt es **Werkzeugkasten → Skizzen mit Beziehungen → Neue Skizze** (oder **In Skizze umwandeln**). In einer Skizze behalten Linien, Rechtecke, Kreise und Bögen ihre Beziehungen und Maße dauerhaft, wie in einem CAD-Programm.

- Beziehungen über die Leiste oben oder per Taste: deckungsgleich (O), waagerecht (H), senkrecht (V), parallel (P), rechtwinklig (N), gleich (E), tangential (T), konzentrisch (X), Mittelpunkt (M), symmetrisch (Y), fest (F).
- **Bemaßen** (D): Eine Linie bekommt eine Länge, zwei Linien einen Winkel, ein Kreis einen Durchmesser, ein Bogen einen Radius, zwei Punkte einen Abstand. Ein Doppelklick auf ein Maß ändert es. Maße können Formeln mit Projektparametern sein, etwa `Breite / 2`.
- Farben: blau = noch frei, dunkel = vollständig bestimmt, rot = Widerspruch.
- Hilfsgeometrie (G) wird gestrichelt gezeichnet und nie gelasert.

Ein Doppelklick öffnet eine Skizze wieder, Enter oder **Fertig** schließt sie, **Abbrechen** verwirft alle Änderungen seit dem Öffnen.
