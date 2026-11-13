---
sidebar_position: 1
title: Eine Box mit graviertem Deckel
description: Eine geschlossene Box mit Fingerzinken aus Sperrholz bauen, mit einem Namen auf dem Deckel, die ohne Leim hält.
---

# Eine Box mit graviertem Deckel

In diesem Tutorial baust du eine geschlossene Box aus 3-mm-Sperrholz, etwa 100 × 80 × 50 mm, mit einem Namen auf dem Deckel. Die Zinken sollen die Box ohne Leim zusammenhalten.

**Du brauchst:** 3-mm-Sperrholz (ein Reststück für den Test, ein Stück von etwa 300 × 200 mm für die Box) und einen Messschieber oder ein Lineal.

## 1. Passung kalibrieren (einmal pro Material)

Eine Box hält nur, wenn Schnittfuge und Steckspiel zu deinem Laser und deinem Material passen. Das misst du einmal, danach merkt KizamuBeam es sich.

1. Miss das Sperrholz mit dem Messschieber an mehreren Stellen und notiere den Mittelwert, etwa 2,9 mm.
2. Wähle im Layer-Fenster das Material des Schnitt-Layers, oder lege es in der [Materialbibliothek](../features/materials-tests.md#material-library) an.
3. Wähle **Laser → Test und Kalibrieren → Passung kalibrieren …**. Die Testteile erscheinen auf einer neuen Seite.
4. Schneide die Testteile mit deinen Schneide-Einstellungen aus einem Reststück.
5. Miss das Quadrat, suche die am besten passende Zunge und den am besten passenden Schlitz und trage die Werte ein. KizamuBeam speichert Schnittfuge und Spiel beim Material.

Mehr dazu unter [Passung kalibrieren](../features/materials-tests.md#calibrate-fit). Lässt du diesen Schritt aus, beginne mit einer Schnittfuge von 0,15 mm und Steckspiel 0 und passe nach der ersten Box an.

## 2. Die Box erstellen

1. Öffne den **Werkzeugkasten** und wähle **Boxen und Möbel → Box mit Fingerzinken**.
2. Stelle **Maße** auf **Außenmaß** und gib Breite `100`, Tiefe `80` und Höhe `50` ein.
3. Gib die gemessene **Materialdicke** ein.
4. Stelle **Oben** auf **Geschlossen (Deckel mit Zinken)**.
5. Mit kalibriertem Material übernimmt der Dialog Schnittfuge und Spiel schon. Sonst trägst du sie selbst ein.
6. Klicke auf **Erstellen**.

Die sechs Wände erscheinen kompakt angeordnet auf der Seite. Sie sind ein parametrisches Teil: Ein Doppelklick auf eine beliebige Wand ändert später die Größe.

## 3. Den Namen auf den Deckel gravieren

1. Such den Deckel: Es ist die Platte mit derselben Breite und Tiefe wie der Boden.
2. Wähle das Textwerkzeug (Ctrl+T), klicke auf den Deckel und tippe einen Namen. Wähle eine Schrift und eine Höhe von etwa 12 mm.
3. Leg den Text auf einen eigenen Layer: Klicke eine andere Farbe in der Palette an und stelle diesen Layer im Layer-Fenster auf **Füllen**.
4. Wähle Text und Deckel aus und zentriere sie mit **C** und **E** aufeinander.
5. Gruppiere den Text mit dem Deckel (Ctrl+G), damit er mitwandert, wenn die Box neu angeordnet wird.

## 4. Die Box in 3D prüfen

Öffne **Fenster → 3D-Ansicht**. Die Box erscheint zusammengebaut, mit dem Namen auf dem Deckel (Kästchen **Gravuren** anhaken). Zieh den Regler **Explosion**, um zu sehen, wie die Wände ineinandergreifen. Rote Stellen bedeuten, dass sich zwei Teile durchdringen; prüfe dann Materialdicke und Spiel.

**Laser → Konstruktion prüfen** vergleicht außerdem jede Verbindung mit der Kalibrierung und findet offene Konturen oder doppelte Linien.

## 5. Lasern

1. Stelle Geschwindigkeit und Leistung auf beiden Layern ein. Nimm die Werte aus deinem [Materialtest](../features/materials-tests.md#material-test) oder aus der Materialbibliothek.
2. Achte darauf, dass der Gravur-Layer in der Layerliste vor dem Schnitt-Layer steht, damit die Wände graviert werden, bevor sie frei geschnitten sind.
3. Prüfe den Job in der Vorschau (Alt+P), leg das Sperrholz ein, fahre den Rahmen ab und starte.

## 6. Zusammenbauen

Steck die Wände von Hand zusammen: erst die Seiten auf den Boden, dann den Deckel. Ist es zu stramm, klopfe die Verbindungen mit einem Holzstück fest, statt sie zu erzwingen. Für die nächste Box:

- **Zu stramm:** Steckspiel um 0,05 mm erhöhen.
- **Zu locker:** Steckspiel um 0,05 mm verringern, oder ein paar Tropfen Holzleim nehmen.

## Weiter geht’s

- Mit einem [Deckelscharnier](../features/construction-3d.md#lid-hinge) lässt sich der Deckel aufklappen.
- Fächer bekommst du mit der **Box mit Fingerzinken und Trennwänden** oder einem [Einsatz mit Fächern](../generators/drawers-shelves.md).
- Speichere das Projekt als Vorlage mit einem Parameter für den Namen: siehe [Namensschilder aus einer Liste](name-tags-from-a-list.md).
