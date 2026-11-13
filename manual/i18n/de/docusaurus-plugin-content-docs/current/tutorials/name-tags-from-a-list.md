---
sidebar_position: 2
title: Namensschilder aus einer Liste
description: Eine Vorlage für Namensschilder anlegen und eine ganze Namensliste in einem Job lasern, aus einer Tabelle oder CSV-Datei.
---

# Namensschilder aus einer Liste

In diesem Tutorial machst du Namensschilder für eine Gruppe, etwa eine Klasse oder einen Workshop, aus einer Namensliste. Du richtest das Schild einmal ein, und KizamuBeam legt für jeden Namen eine Kopie an.

**Du brauchst:** die Namensliste, in einer Tabellenkalkulation oder zum Abtippen, und Material für die Schilder (3-mm-Sperrholz oder Acryl eignen sich gut).

## 1. Mit der Vorlage beginnen

1. Wähle **Datei → Neu aus Vorlage …** und dann **Namensschild**.
2. Der Ausfülldialog zeigt die Felder der Vorlage: den Namen, eine **Zweite Zeile**, die Größe und ob das Schild zwei Löcher bekommt. Gib eine Größe ein, die zu deinem Material passt, etwa 80 × 30 mm, und bestätige.

Die Vorlage ist ein normales Projekt mit [Parametern](../features/templates-library.md#parameters). Öffne **Fenster → Parameter**, um sie zu sehen: Der Text auf dem Schild enthält `{Name}`, das durch den Wert des Parameters ersetzt wird.

Du kannst auch dein eigenes Schild gestalten: zeichne es, lege im Fenster Parameter einen Text-Parameter an und schreibe `{Name}` in einen Text.

## 2. Die Tabelle ausfüllen

1. Wähle **Datei → Serie aus Tabelle (CSV) …**.
2. Trage die Namen ein, eine Zeile pro Schild. Du kannst aus einer Tabellenkalkulation kopierte Zellen einfügen oder eine Datei mit **CSV importieren …** laden.
3. Unter **Spalten zuordnen** wählst du, welche Spalte welchen Parameter füllt. Spalten, deren Überschrift einem Parameternamen entspricht, werden automatisch zugeordnet. Lass die zweite Zeile auf **— Wert bleibt —**, wenn auf jedem Schild derselbe Text stehen soll.

## 3. Die Serie anordnen

1. Wähle unter **Anordnung** die Option **Raster: so viele wie aufs Bett passen, dann weitere Seiten**. Stelle den Abstand zwischen den Schildern ein, etwa 3 mm.
2. Klicke auf **Serie anlegen**.

KizamuBeam legt die Schilder auf neuen Seiten hinter der aktuellen an, mit eingesetzten Namen. Deine Vorlagenseite bleibt, wie sie war, und die Tabelle wird mit dem Projekt gespeichert: Du kannst später Namen ergänzen und die Serie neu anlegen.

Lange Namen ändern die Größe des Schilds nicht. Prüfe die Seiten auf Namen, die zu breit für das Schild sind, und kürze sie oder verkleinere die Schrift auf der Vorlagenseite, bevor du die Serie neu anlegst.

## 4. Die Schilder lasern

1. Wähle eine Seite mit Schildern, prüfe die Layer (Gravur auf **Füllen**, Kontur auf **Linie**) und sieh dir die Vorschau an (Alt+P).
2. Leg das Material ein, fahre den Rahmen ab und starte. Dann weiter mit der nächsten Seite.

## Varianten

- **Zähler und Datum:** Für Seriennummern oder ein Datum bei jedem Job statt einer festen Liste nimmst du [variablen Text](../features/text.md).
- **Rohlinge in Serie:** Gravierst du fertige Rohlinge, schneide einen [Jig](../features/print-and-cut.md#jigs) und nutze **Auf Jig-Fächer legen**: Variabler Text zählt pro Fach weiter.
- **Eigene Vorlage:** **Datei → Als Vorlage speichern …** macht aus deinem Schild eine Vorlage, die ihre Werte abfragt, mit eigenen Feldern und Schiebereglern.
