---
sidebar_position: 10
title: Verbindungen, Scharniere und 3D-Ansicht
description: Fingerzinken, Zapfen, Schnappverbindungen und Scharniere an beliebige Formen setzen, Schlitze an das Material anpassen und Baugruppen in der 3D-Ansicht prüfen.
---

# Verbindungen, Scharniere und 3D-Ansicht

KizamuBeam macht aus gewöhnlichen Formen Teile, die sich zusammenstecken oder verleimen lassen. Die [Generatoren](../generators/index.md) bauen komplette Boxen, Schubladen und Regale; die Werkzeuge auf dieser Seite arbeiten mit Formen, die du selbst gezeichnet oder importiert hast.

## Das Werkzeug Verbindung

Das Werkzeug **Verbindung** (die Verbindungs-Schaltfläche in der Werkzeugleiste oder **Werkzeugkasten → Verbindungen und Biegen → Verbindungen**) setzt eine Verbindung zwischen zwei geraden Kanten:

1. Wähle das Werkzeug. Die Statusleiste fragt nach der ersten Kante.
2. Klicke die erste gerade Kante an. Sie bekommt die Zinken oder Zapfen.
3. Klicke die zweite gerade Kante an. Sie bekommt das Gegenstück oder die Schlitze. Ist die zweite „Kante“ eine einzelne gezeichnete Linie, wird die Linie durch Schlitze ersetzt; so setzt du einen Schlitz mitten in eine Platte.
4. Stelle die Optionen im Dialog ein und bestätige.

Das Ergebnis bleibt ein gewöhnlicher, bearbeitbarer Pfad. Die Verbindung merkt sich die Materialdicke, sodass [Schlitze anpassen](#resize-slots-to-the-material) sie später aktualisieren kann.

| Art | Einsatz |
|---|---|
| **Fingerzinken** | Boxecken: ineinandergreifende Zinken entlang beider Kanten. |
| **Schlitz und Zapfen** | Zapfen an einer Platte, passende Schlitze in der anderen, auch mitten in einer Platte. |
| **Überblattung** | Beide Teile bekommen Schlitze in Materialdicke und werden ineinandergeschoben; die Tiefe teilt sich auf beide auf (z. B. je 50 %). Mehrere Schlitze ergeben Gittereinsätze und Flaschenteiler. |
| **Schnappverbindung** | Zapfen mit zwei federnden Zungen und Rasthaken; Überstand, Hakenlänge und Federschlitz sind einstellbar. Hält ohne Leim. |
| **Hakenverbindung** | L-förmige Hakenzapfen: einstecken, dann verschieben. Der Schlitz wird um die Hakenlänge verlängert. |
| **Keilzapfen** | Zapfen gehen durch die andere Platte und haben ein Keilloch; die Keile werden mit erzeugt. |
| **T-Slot** | Ein Schraubenschlitz mit Mutternfenster zwischen je zwei Zapfen und ein passendes Schraubenloch in der anderen Platte. |
| **Scharnier für Deckel (mit Stift)** | Siehe [Deckelscharnier](#lid-hinge) unten. |

Gemeinsame Einstellungen sind die Materialdicke, die **Schnittfuge (Kerf)** (Zinken und Zapfen werden breiter, Lücken und Schlitze schmaler gezeichnet, damit die Teile nach dem Schneiden ihr Nennmaß haben) und das **Spiel** je Seite (negative Werte ergeben eine Presspassung). Ist das Material [kalibriert](materials-tests.md#calibrate-fit), schlägt das Werkzeug Kerf und Spiel für die gewählte Art vor.

## Deckelscharnier {#lid-hinge}

Ein Scharnier mit Stift lässt einen Boxdeckel weiter als 90° aufgehen. Starte es über **Werkzeugkasten → Boxen und Möbel → Deckelscharnier** oder wähle im Werkzeug Verbindung **Scharnier für Deckel (mit Stift)**:

1. Klicke die Oberkante der Rückwand an.
2. Klicke die Hinterkante des Deckels an.

Beide Platten bekommen Schlitze, und daneben entstehen Knöchel mit Stiftlöchern. Die äußeren Knöchel gehören zur Box, die dazwischen zum Deckel. Leime die Knöchel in die Schlitze und schiebe einen Stift (Draht, Dübel, Nagel oder Filament) durch alle Augen. Anzahl der Knöchel, Stiftdurchmesser, Spiel des Stifts und Wandstärke um das Loch sind einstellbar.

## Biegeschnitte {#living-hinges}

**Werkzeugkasten → Verbindungen und Biegen → Biegeschnitte** füllt eine ausgewählte geschlossene Form mit einem Schnittmuster, damit sich die Platte dort biegen lässt. Muster: gerade Schnitte, Wellen, Rauten, Waben, Dreiecke, Flechtmuster und Spirale. Der Dialog zeigt eine Live-Vorschau und beginnt mit Werten, die zur Materialdicke passen. Die Schnitte sind exakte Linien und Bézierkurven.

Lege den Biegebereich auf den Schnitt-Layer des Teils. Sperrholz und MDF biegen sich am besten quer zur Faser des Deckfurniers; probiere es zuerst an einem Reststück.

## Schlitze an das Material anpassen {#resize-slots-to-the-material}

Material ist selten genau so dick wie angegeben. **Werkzeugkasten → Verbindungen und Biegen → Schlitze anpassen** findet die Schlitze, in die eine andere Platte gesteckt wird, auch in importierten SVG- oder DXF-Entwürfen und in Teilen, die schon einfache Pfade sind:

- Ausschnitte (Zapfenlöcher, auch ein eigenes Rechteck in einer Platte),
- vom Rand eingeschnittene Kerben (Kreuzschlitze, Überblattungen),

jeweils mit zwei parallelen Seiten und tiefer als breit. Lücken von Fingerzinken bleiben unberührt.

Der Dialog schlägt die häufigste Schlitzbreite vor (oder die Dicke des Layer-Materials), markiert die gefundenen Schlitze orange und macht jeden Schlitz um die Differenz zur neuen Dicke breiter oder schmaler, sodass das Spiel gleich bleibt. Er durchsucht die Auswahl oder, wenn nichts ausgewählt ist, die ganze Seite. Boxen, Schubladen, Einsätze und Regale aus den Generatoren bekommen die neue Dicke stattdessen als Parameter. Ein Rückgängig-Schritt.

## Schlitze und Ausklinkungen platzieren

**Werkzeuge → Schlitze / Ausklinkungen platzieren …** setzt rechteckige Schlitze oder Ausklinkungen in genauem Abstand in eine geschlossene Form:

1. Wähle ein geschlossenes Vektorobjekt aus.
2. Wähle in der Vorschau des Werkzeugs eine Bezugsecke (rot) und eine gerade Kante (orange).
3. Gib den Abstand entlang der Kante ein und wähle, ob er bis zur ersten Außenkante, zur Mitte oder zur zweiten Außenkante des Schlitzes gemessen wird.

Du kannst mehrere Schnitte an verschiedenen Kanten vorbereiten, bevor du sie anwendest. **Übernehmen** ist ein Rückgängig-Schritt, **Abbrechen** verwirft alles, und ein Doppelklick auf das Teil öffnet das Werkzeug wieder.

## 3D-Ansicht {#3d-view}

**Fenster → 3D-Ansicht** (oder die 3D-Schaltfläche in der Hauptleiste) zeigt deine Teile zusammengebaut, so wie sie nach dem Schneiden sind:

- Boxen, Schubladen, Einsätze, Regale und Zahnradpaare aus den Generatoren werden automatisch zusammengesetzt. Die Räder eines Zahnradpaars lassen sich drehen.
- Mit dem Werkzeug Verbindung verbundene Teile werden an den verbundenen Kanten zusammengesetzt: Ein Teil liegt flach, die anderen stehen darauf.
- Andere geschlossene Formen auf Schnitt-Layern liegen flach mit einstellbarer Dicke; verschachtelte Formen werden Löcher.
- Schicht-, Rippen- und Scheibenmodelle aus [3D-Modellen](../generators/index.md) werden zusammengebaut gezeigt.

Drehe die Ansicht mit der Maus oder nutze die festen Ansichten (3D, oben, vorn). Der Regler **Explosion** zieht die Teile auseinander. Ohne Auswahl zeigt die Ansicht die ganze Seite; ein ausgewähltes Teil bringt immer seine ganze Baugruppe mit.

**Kollisionen**: Wo sich zwei Teile durchdringen (etwa bei einer Presspassung oder einem zu schmalen Schlitz), färbt sich die Stelle rot, und die Statuszeile nennt die Teile und das Volumen.

**Gravuren**: Mit dem Kästchen **Gravuren** erscheinen Füllungen, gravierte Linien, Text und bearbeitete Bilder auf der Seite, die beim Lasern oben lag, mit leichter Tiefe.

### Materialaussehen {#material-look}

Jeder Schnitt-Layer kann im Layer-Dialog unter **Aussehen in 3D** sein eigenes Aussehen bekommen: 21 Vorgaben wie Pappel- und Birkensperrholz, Buche, Eiche, Nussbaum, Bambus, MDF, Karton, Kork, Leder, Schiefer, Granit, klares, farbiges und deckendes Acryl, Glas, eloxiertes Aluminium und Edelstahl, jeweils mit optionaler eigener Farbe. Gravuren sehen je Material anders aus: dunkel gebrannt auf Holz, hellgrau auf Schiefer, mattweiß auf Acryl und Glas. Layer ohne eigenes Aussehen übernehmen es aus dem Namen ihres Eintrags in der [Material-Bibliothek](materials-tests.md#material-library).

Um ein flaches Stück ohne Schnitt zu zeigen (etwa einen Schieferuntersetzer), zeichne seinen Umriss auf einen Layer mit ausgeschalteter Ausgabe: Er wird zur Platte.

### Mockups für Kunden

Mit **Mockup** im 3D-Fenster verschwinden Raster und rote Kollisionen, und es gibt weiche Schatten und einen Hintergrund deiner Wahl (Studio-Verlauf, weiß, grau, dunkel oder wie die Oberfläche). **Bild speichern …** speichert die aktuelle Ansicht als PNG in doppelter Auflösung.

## Vor dem Schneiden prüfen {#check-the-design-before-cutting}

**Laser → Konstruktion prüfen** (oder **Fenster → Prüfung**) sucht auf der aktuellen Seite nach Problemen und markiert jeden Fund auf der Arbeitsfläche. Ein Klick auf einen Fund wählt die Objekte aus und zoomt an die Stelle; wo möglich, behebt eine Schaltfläche das Problem in einem Rückgängig-Schritt.

Gefunden werden unter anderem:

- Linien, die doppelt geschnitten würden,
- fast geschlossene Konturen (Lücke bis 1 mm) und einzelne Linien, die eine Kontur bilden, aber nicht verbunden sind,
- offene Linien auf Füll-Layern, die übersprungen würden,
- Stege zwischen zwei Schnitten, die schmaler als der Mindeststeg sind (Standard 1 mm, Schnittbreite eingerechnet),
- Ausschnitte, die für die Schnittbreite zu klein sind,
- Objekte außerhalb des Arbeitsbereichs,
- Elemente, die ein SVG- oder DXF-Import überspringen musste,
- die **Passung** von Steckverbindungen aus den Generatoren und dem Werkzeug Verbindung gegenüber Materialdicke und Kerf (zu eng, sehr eng, sehr locker).

Die **Montageprüfung** geht bei Generator-Baugruppen (Box, Schublade, Einsatz, Regal, Scheibenkugel, Schicht- und Rippenmodell) weiter: Jedes Stück muss ein zusammenhängendes Teil sein, und die Prüfung setzt die Teile nacheinander zusammen. Klappt keine Reihenfolge mit geraden Bewegungen, gibt es eine Warnung.

Die Einstellungen (Mindeststeg, Schnittbreite, Lückengröße, Layer, die nur gravieren) stehen im selben Fenster, zusammen mit der Option, vor jedem Job zu prüfen. Bleiben beim Start eines Jobs Probleme übrig, listet KizamuBeam sie auf und fragt, ob es weitergehen soll.
