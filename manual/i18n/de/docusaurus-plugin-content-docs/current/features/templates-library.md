---
sidebar_position: 16
title: Vorlagen, Bibliothek und Erweiterungen
description: Entwürfe mit Parametern anpassbar machen, als Vorlagen speichern, Serien aus einer Tabelle erzeugen, Motive aus der Bibliothek wiederverwenden und Erweiterungen installieren.
---

# Vorlagen, Bibliothek und Erweiterungen

## Parameter {#parameters}

**Fenster → Parameter** enthält benannte Werte für das ganze Projekt: Zahlen, Texte und Ja/Nein-Werte. Du kannst sie überall nutzen:

- In einem Text oder QR-Code setzt `{Name}` den Wert ein. Formeln gehen auch: `{Breite / 2}`, `{round(Länge; 1)}`, `{Name + " GmbH"}`, `{Deckel ? "mit Deckel" : ""}`. Für echte geschweifte Klammern schreibst du `{{` und `}}`.
- In der Eigenschaftenleiste (X, Y, Breite, Höhe, Drehung, Eckenradius, Schriftgröße und mehr) kannst du statt einer Zahl eine Formel eingeben. Ein gebundenes Feld zeigt seine Formel kursiv; eine einfache Zahl entfernt die Formel wieder.
- Felder von Generatoren (etwa die Materialdicke einer Box) nehmen einen Parameter oder eine Formel an; Auswahl- und Ja/Nein-Felder bekommen eine über die ƒ-Schaltfläche.

Ändert sich ein Wert, wird alles auf einmal neu berechnet, auf allen Seiten. Zahlen können einen Bereich haben und bekommen dann einen Schieberegler. Benennst du einen Parameter um, ändert sich der Name in allen Texten und Formeln mit.

**Bearbeiten → Sichtbar, wenn …** zeigt und lasert ein Objekt nur, solange eine Bedingung gilt, etwa `Deckel` oder `Breite > 100`. Solche Objekte tragen im Fenster Objekte ein ƒ.

## Vorlagen

Eine Vorlage ist ein Projekt mit Parametern, das beim Verwenden nach seinen Werten fragt.

- **Datei → Als Vorlage speichern …** speichert das aktuelle Projekt als Vorlage (`.kzt`) mit Titel, Beschreibung und Vorschaubild. Du legst fest, welche Parameter abgefragt werden, in welcher Reihenfolge, mit welcher Beschriftung und ob als Schieberegler. Nicht abgefragte Parameter behalten ihren Wert.
- **Datei → Neu aus Vorlage …** zeigt deine Vorlagen. Wählst du eine, öffnet sie sich als neues Projekt mit einem Ausfüll-Dialog und Live-Vorschau. Abbrechen führt zurück, wo du warst.
- **Datei → Vorlage ausfüllen …** fragt die Werte des aktuellen Projekts noch einmal ab.

KizamuBeam bringt einen **Schlüsselanhänger** (der Name wird passend verkleinert), ein **Namensschild** (optionale zweite Zeile und Löcher) und eine **beschriftete Box** (eine Box mit Fingerzinken und Beschriftung auf der Vorderseite) mit. Vorlagen aus installierten Erweiterungen erscheinen unter „Aus Erweiterungen“.

`.kzt`-Dateien fügst du mit **Aus Datei …** im Vorlagen-Dialog hinzu oder ziehst sie auf die Arbeitsfläche. Um eine Vorlage zu ändern, öffne sie mit **Datei → Öffnen …**, bearbeite sie und speichere sie erneut als Vorlage. In der Desktop-App liegen die Vorlagen im Ordner `templates` des Einstellungsordners (**Ordner zeigen** öffnet ihn).

## Serie aus einer Tabelle {#series-from-a-table}

**Datei → Serie aus Tabelle (CSV) …** macht aus jeder Zeile einer Tabelle eine Kopie der aktuellen Seite mit eingesetzten Werten, etwa Namensschilder für eine ganze Klasse.

1. Richte den Entwurf mit Parametern ein (etwa `{Name}` in einem Text).
2. Öffne den Dialog und fülle die Tabelle: eine Spalte pro Parameter, eine Zeile pro Kopie. Du kannst Zellen aus einer Tabellenkalkulation einfügen oder eine CSV-Datei importieren.
3. Wähle die Anordnung: ein Raster ab dem Maschinenursprung (auf weiteren Seiten fortgesetzt) oder eine Seite pro Zeile.

Die Kopien kommen auf neue Seiten hinter der aktuellen, mit ersetzten Platzhaltern. Deine Vorlagenseite bleibt bearbeitbar. Die Tabelle wird mit dem Projekt gespeichert, so kann eine Vorlage ihre eigene Liste mitbringen. Spalten werden den Parametern über den Namen zugeordnet oder von Hand gewählt; Zahlen dürfen ein Dezimalkomma haben, und Ja/Nein-Spalten verstehen 1, ja und x. Ein Rückgängig-Schritt.

Für Zähler und Datum bei jedem Job statt einer festen Liste siehe [variabler Text](text.md).

## Werkzeugkasten

**Werkzeuge → Werkzeugkasten …** (auch **Fenster → Werkzeugkasten** und die Kachel-Schaltfläche in der Werkzeugleiste) zeigt alle Generatoren und Spezialwerkzeuge als Kacheln, in Gruppen: Mechanik, Boxen und Möbel, 3D-Steckmodelle, Skizzen mit Beziehungen, Verbindungen und Biegen, Vervielfältigen und Anordnen, Text und Daten, Bild, Laser und Kalibrieren.

- Die **Suche** durchsucht Namen, Beschreibungen und Stichwörter auf Deutsch und Englisch; Enter startet den ersten Treffer.
- **Favoriten**: Rechtsklick auf eine Kachel heftet sie oben an. Unter den Favoriten stehen die drei zuletzt benutzten Werkzeuge.
- Neue Werkzeuge tragen „NEU“, bis du sie einmal benutzt hast.
- Braucht ein Werkzeug eine Auswahl, sagt die Statusleiste, was auszuwählen ist.

## Bibliothek

**Fenster → Bibliothek** bewahrt Motive, Bilder und Gestaltungselemente zum Wiederverwenden auf, mit Vorschau, Suche und Schlagwörtern.

- **+ Auswahl** (oder **Bearbeiten → Zur Bibliothek hinzufügen …**) speichert die ausgewählten Objekte mit Name, Art und Schlagwörtern.
- **Dateien …** oder das Ziehen von SVG-, DXF-, PDF-, AI-, Bild- oder `.kza`-Dateien auf das Fenster fügt Dateien direkt hinzu.
- Ein Doppelklick auf einen Eintrag oder das Ziehen auf die Arbeitsfläche fügt ihn als Gruppe ein. Ein Eintrag auf einem einzigen Layer landet auf dem aktuellen Layer.
- Einträge lassen sich umbenennen, neu verschlagworten und als `.kza`-Datei zum Weitergeben exportieren.

KizamuBeam bringt **400 eingebaute Einträge** in eigenem Design mit, bereit zum Schneiden oder Gravieren: 200 Motive (Tiere, Pflanzen, Essen, Feiertage, Fahrzeuge, Werkzeuge, Symbole, Sternzeichen, Weltraum und mehr) und 200 Gestaltungselemente (Rahmen, Bordüren, Ecken, Trenner, Ornamente, Abzeichen, Banner, Muster). Alle sind geschlossene Vektorpfade. Eingebaute Einträge lassen sich nicht ändern; füge einen ein und speichere ihn mit **+ Auswahl**, um deine eigene Fassung zu behalten.

Die Bibliothek enthält auch die Muster für [Muster füllen](arranging.md).

## Erweiterungen {#extensions}

**Datei → Erweiterungen …** installiert Pakete (`.kzp`-Dateien), die Gerätevorlagen, Vorlagen, Einträge für die Material-Bibliothek und Bibliothekselemente hinzufügen, ohne neue Version von KizamuBeam. Ein Paket enthält nur Daten, nie Programmcode, und jeder Eintrag wird vor der Installation geprüft.

- Der **Katalog** im selben Fenster listet die offiziellen Pakete: Installieren oder Aktualisieren mit einem Klick. Der Katalog ist signiert, und jedes Paket wird gegen seine Prüfsumme geprüft.
- **Installieren …** oder das Ziehen einer `.kzp`-Datei auf die Arbeitsfläche installiert ein Paket aus einer Datei. Der Dialog listet den Inhalt und sagt, ob es ein Update ist.
- Wird ein Paket entfernt, verschwinden seine Einträge wieder.

Was es gibt, steht in der [Liste der Erweiterungen](../extensions/index.md).
