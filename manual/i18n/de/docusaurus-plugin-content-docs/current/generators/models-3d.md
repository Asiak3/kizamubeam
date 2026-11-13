---
sidebar_position: 5
title: Schicht- und Rippenmodelle
description: Eine STL- oder OBJ-Datei in gestapelte Schichten zum Verleimen oder in Rippen auf einem Rückgrat verwandeln.
---

# Schicht- und Rippenmodelle

KizamuBeam macht aus einem 3D-Modell (STL, binär oder Text, oder OBJ) flache Teile, die du lasern kannst. Es gibt zwei Wege, beide unter **Werkzeugkasten → 3D-Steckmodelle**. Öffnest oder importierst du eine STL- oder OBJ-Datei oder ziehst sie auf die Arbeitsfläche, fragt KizamuBeam, welchen du möchtest.

Das Modell wird einmal in der Projektdatei gespeichert, sodass sich die Teile später per Doppelklick erneut bearbeiten lassen.

## Schichtmodell

Das Modell wird in gestapelte Platten geschnitten, die du wieder zusammenleimst: Köpfe, Figuren, Reliefs, Gelände.

| Einstellung | Bedeutung |
|---|---|
| **Oben im Modell** | Welche Achse der Datei nach oben zeigt. |
| **Schichten** | Stapelrichtung: von unten nach oben, von vorn nach hinten oder von links nach rechts. |
| **Größe (längste Seite)** | Größe des fertigen Modells in mm. |
| **Materialdicke** | Dicke jeder Platte. |
| **Querschnitt** | Wo jede Platte ihre Kontur abnimmt: in der Mitte der Schicht; **außen** (es fehlt nichts, die Stufen werden abgeschliffen); oder **innen** (keine Schicht steht über). |
| **Nummern gravieren** | Jede Platte bekommt ihre Nummer, von unten gezählt, als feine Gravur auf einem eigenen Layer „Beschriftung“. |
| **Kleinste Fläche (mm²)** | Kleinere Inseln fallen weg, kleinere Löcher werden gefüllt (Erweitert). |
| **Schnittfuge (Kerf)** | Breite des Laserschnitts. |

Mehrere überlappende Körper in der Datei werden je Schicht vereinigt. Löcher im Netz bis 0,5 mm werden überbrückt und gemeldet. Die Prüfung warnt vor leeren Schichten, Schichten aus mehreren Stücken und sehr vielen Schichten. Die 3D-Ansicht zeigt den Stapel.

**Tipp:** Wähle bei einem breiten Modell die Stapelrichtung (**Schichten**) so, dass die Schichten möglichst groß werden: weniger Schichten, weniger Leimen.

## Rippenmodell

Rippen stehen quer zu einer Achse und werden mit Halbschlitzen auf ein Rückgrat gesteckt, wie bei Holztier-Bausätzen.

| Einstellung | Bedeutung |
|---|---|
| **Oben im Modell** | Welche Achse der Datei nach oben zeigt. |
| **Achse** | Links–rechts, vorn–hinten oder unten–oben: die Richtung, der die Rippen folgen. |
| **Rückgrat steht** | Aufrecht, nach vorn gewandt oder seitlich. |
| **Größe (längste Seite)** | Größe des fertigen Modells. |
| **Materialdicke** | Dicke der Platte. |
| **Rippenabstand (Mitte zu Mitte)** | Abstand der Rippen. |
| **Rückgrat nach innen versetzt** | Verhindert, dass das Rückgrat zwischen den Rippen übersteht (0 = volle Kontur). |
| **Steckspiel** | Zusätzliche Schlitzbreite; negativ = Presspassung. |
| **Nummern gravieren** | Jede Rippe bekommt ihre Nummer; das Rückgrat unter jedem Schlitz die Nummer der passenden Rippe. |
| **Bauplan als eigene Seite** | Fügt eine Seite (wird nicht gelasert) mit Ansicht, allen Teilenummern, Montagereihenfolge und Stückliste hinzu. |
| **Schnittfuge (Kerf)** | Breite des Laserschnitts. |

Wo sich Rippe und Rückgrat kreuzen, wird die gemeinsame Linie geteilt: Die Rippe wird von unten geschlitzt, das Rückgrat von oben, sodass die Rippen von oben auf das Rückgrat geschoben werden. Rippenstücke, die kein Rückgrat erreichen, fallen mit einer Warnung weg.

### Abschnitte

Tiere und Figuren brauchen mehr als ein Rückgrat: Körper, Beine, Kopf, Schwanz. In der Zeichenfläche des Dialogs (Vorder-, Seiten- und Draufsicht mit der Silhouette des Modells) zeichnest du **Abschnitte**, jeden mit eigener Achse. Eine Achse kann ein Linienzug sein; die Rippen stehen dann quer zur Kurve.

Jeder Abschnitt hat eine Ebenenlage (**Mitte** legt sie in die Mitte des Materials), einen eigenen Rippenabstand, einen Radius für den Bereich, der ihm gehört, und eine Verlängerung seines Rückgrats über die Achse hinaus, sodass eine Beinplatte in den Körper reicht und in die Körperrippen greift. Die Kopier-Schaltfläche spiegelt einen Abschnitt, etwa für das zweite Bein. Ziehe Punkte und Linien, um sie zu ändern; in einer anderen Ansicht verschiebt Ziehen die Ebene.

**Vorschlagen** findet Abschnitte automatisch als Ausgangspunkt: Die Spiegelebene des Modells wird zum Rückgrat des Körpers, Beine werden vom Boden aufwärts verfolgt, und dünne Enden wie ein Schwanz bekommen eigene, gebogene Abschnitte. Prüfe und korrigiere den Vorschlag vor dem Erstellen.

Weitere Optionen:

- **Dichter an Details bis**: Wo sich die Kontur schnell ändert (Nase, Ohren), rücken die Rippen enger zusammen, bis zu diesem Abstand.
- **Platten teilen ab** (Erweitert): Rückgratplatten, die länger sind, etwa länger als das Bett, werden geteilt und mit einem Schwalbenschwanz verbunden.
- **Rückgrat verschieben** (Erweitert): verschiebt das Rückgrat aus der Mitte.

Die 3D-Ansicht zeigt das zusammengebaute Modell und prüft es auf Kollisionen; die [Konstruktionsprüfung](../features/construction-3d.md#check-the-design-before-cutting) prüft außerdem, ob sich die Teile in irgendeiner Reihenfolge zusammenbauen lassen.

**Tipp:** Dünne Teile wie Beine brauchen einen Rippenabstand, der ihnen mindestens zwei oder drei Rippen gibt, sonst haben sie keinen Halt. Dickeres Material macht das Modell stabiler, aber gröber.
