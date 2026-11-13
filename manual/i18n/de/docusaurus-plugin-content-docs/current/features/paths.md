---
sidebar_position: 2
title: Pfade und Formen
description: Formen mit booleschen Operationen kombinieren, versetzen, verformen, Ecken runden, Pfade verbinden, trimmen und vereinfachen.
---

# Pfade und Formen

Die Formwerkzeuge von KizamuBeam liefern immer saubere Bézierkurven: Ecken und gerade Abschnitte bleiben erhalten, Rundungen werden mit höchstens 0,02 mm Abweichung angepasst. Die Ergebnisse bleiben bearbeitbar wie alles, was du zeichnest.

## Boolesche Operationen

Wähle zwei oder mehr Formen aus und dann eine der Operationen unter **Werkzeuge → Boolesche Operationen** oder in der Schaltflächengruppe der Hauptleiste:

| Operation | Kürzel | Ergebnis |
|---|---|---|
| **Vereinen** | Alt++ | Verschmilzt die Formen zu einer Kontur. Bei einer einzelnen Gruppe oder einem Text werden deren überlappende Teile verschmolzen. |
| **Abziehen** | Alt+- | Schneidet eine Form aus den anderen heraus. |
| **Schnittmenge** | Alt+* | Behält nur die Fläche, an der sich die Formen überlappen. |

Die **Booleschen Optionen** (in der Schaltflächengruppe oder unter **Werkzeuge → Boolesche Operationen**) legen fest, welche Form die Basis ist (zuerst gewählt, hinterste oder vorderste) und ob die Originale erhalten bleiben. Im selben Menü stehen auch **Vordere vom hinteren abziehen** und **Hintere vom vorderen abziehen**.

Gut zu wissen:

- Formen in einer Gruppe zählen als eine Fläche, Überlappungen innerhalb einer Gruppe werden also keine Löcher.
- Texte und Gruppen werden automatisch als Konturen behandelt.
- Offene Linien, etwa Biegeschnitte, werden an abgezogenen Formen exakt gekürzt.
- Bilder bleiben außen vor.

## Offset

**Offset** (Alt+O) zeichnet eine neue Kontur im gewünschten Abstand, nach außen, nach innen oder beides, mit runden, spitzen oder abgeschrägten Ecken und Live-Vorschau. Offene Linien bekommen eine geschlossene Kontur drumherum. Typische Anwendungen: ein Rand um einen Text, eine Grundplatte oder eine Tasche für eine Einlegearbeit.

## Verformen

**Werkzeuge → Verformen …** biegt die Auswahl über ihren Rahmen: Bogen, Bogen oben, Bogen unten, Wölbung, Fahne oder Fluchtpunkt-Perspektive, von −100 bis 100 %, wahlweise um 90° gedreht. Formen, Texte und Bilder werden gemeinsam verformt. Formen und Texte werden zu Bézierpfaden, Bilder werden in ihrer Originalauflösung neu berechnet.

## Pfadwerkzeuge

Unter **Werkzeuge → Pfad**:

- **Pfad schließen** schließt offene Pfade, deren Enden höchstens 0,5 mm auseinanderliegen. **Pfade mit Toleranz schließen …** geht bis 20 mm und zeigt, wie viele Formen geschlossen werden.
- **Ausgewählte Formen verbinden** (Alt+J) fügt offene Pfade, deren Enden sich treffen (innerhalb 0,05 mm), zu einem Pfad zusammen.
- **Zerlegen** (Alt+B) teilt Pfade, Formen und Texte in ihre einzelnen Linien und Kurven.
- **Formen trimmen** (Ctrl+K): Fährst du über eine Kurve, färbt sich das Stück bis zu den nächsten Schnittpunkten rot und wird mit einem Klick entfernt. Die übrigen Stücke werden an den Schnittpunkten verbunden, zwei überlappende Kreise werden so nach zwei Klicks zu einer Kontur. Ctrl+Klick verbindet nicht, Shift+Klick behält das entfernte Stück.
- **Startpunkt setzen**: Einen Knoten anklicken, damit der Schnitt dort beginnt, oder eine Kante anklicken, um dort einen neuen Startknoten einzufügen. Shift+Klick kehrt die Richtung um. Solange das Werkzeug aktiv ist, zeigt die Arbeitsfläche alle Startpunkte, Richtungen, An- und Ausschnitte genau so, wie der Job sie schneidet.
- **Richtung umkehren** dreht die Schnittrichtung um.
- **Mittelpunkte markieren** setzt ein kleines Kreuz in die Mitte jedes Kreises und Bogens, zum Ankörnen oder Bohren.

## Weitere Pfadwerkzeuge

- **Werkzeuge → Außenkontur und Inseln ableiten …** leitet die äußere Silhouette der ausgewählten Objekte ab, wahlweise mit ausgewählten Innenflächen, etwa als Grundplatte.
- **Werkzeuge → Pfad → Pfadinseln trennen …** teilt einen Pfad aus mehreren getrennten Stücken in eigenständige Objekte; jedes Stück behält seine Löcher.
- **Werkzeuge → Pfad → Freihandpfad bearbeiten …** setzt einen offenen Pfad an einem Ende fort oder zeichnet einen Abschnitt zwischen zwei Knoten von Hand neu.
- **Werkzeuge → Lokaler Konturversatz …** schiebt nur einen Teil einer Kontur nach außen oder innen.

## Ecken runden und fasen

**Werkzeuge → Pfad → Ecken runden oder fasen …** rundet Ecken jeder Vektorform mit genauem Radius, rundet sie nach innen oder fast sie an. Im Knoteneditor wirkt es auf die ausgewählten Knoten, sonst auf alle Ecken der ausgewählten Formen. Ist eine Kante zu kurz, wird der Radius verkleinert.

## Pfade vereinfachen {#simplifying-paths}

**Werkzeuge → Pfade vereinfachen / glätten…** passt die ausgewählten Pfade mit weniger Knoten neu an, als Kurven oder als Geraden, innerhalb einer Toleranz in mm. Scharfe Ecken können erhalten bleiben. Eine orange Vorschau zeigt das Ergebnis, bevor du es übernimmst. Das hilft bei nachgezeichneten Bildern und importierten Dateien mit sehr vielen Knoten.
