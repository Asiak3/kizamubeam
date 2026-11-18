---
sidebar_position: 19
title: Anpassen und Einstellungen
description: Fenster und Leisten anordnen, Sprache und Design wechseln und deine Einstellungen auf einen anderen Rechner übertragen oder synchron halten.
---

# Anpassen und Einstellungen

## Fenster Einstellungen

**Bearbeiten → Einstellungen …** enthält alle programmweiten Einstellungen in einem Fenster, mit einer Seitenleiste (Allgemein, Darstellung, Arbeitsfläche und Fangen, Maus und Tastatur, Maschinen und Dienste, Erweiterungen und Schriften) und einer Suche über alle Bereiche. Änderungen gelten mit **OK**; **Abbrechen** verwirft sie, und **Standardwerte** setzt den aktuellen Bereich zurück.

Einstellungen, die es auch als Menüeintrag gibt (Sprache, Design, Fangen, Raster und so weiter), sind dieselben Werte: Änderst du sie an einer Stelle, ändern sie sich auch an der anderen.

## Sprache und Design

- **Ansicht → Sprache**: Deutsch, Englisch oder Italienisch. Standardmäßig folgt sie der Systemsprache.
- **Ansicht → Design** (oder die Schaltfläche ganz rechts in der Hauptleiste): hell oder dunkel. Standardmäßig folgt es dem System.

## Fenster anordnen

Die Werkzeugfenster (Schnitte / Layer, Objekte, Laser, Verschieben, Konsole, Material, Kamera und weitere) lassen sich frei anordnen:

- Ziehe einen Tab auf den Kopf eines anderen Tabs, um die Fenster als Tabs zusammenzulegen.
- Ziehe ihn an den oberen oder unteren Rand einer Gruppe, um ihn darüber oder darunter zu platzieren.
- Ziehe ihn an den linken Rand neben die Werkzeugleiste, um ihn links anzudocken.
- Ziehe ihn auf die Arbeitsfläche, um ein freies Fenster daraus zu machen. ⇥ oder ein Doppelklick auf seinen Kopf dockt es wieder an.

Die Trennlinien zwischen Fenstern lassen sich ziehen. ▾ oder ein Doppelklick auf einen Kopf klappt eine Gruppe ein, × auf einem Tab blendet das Fenster aus. Das Menü **Fenster** blendet alle Fenster und Leisten ein und aus.

## Funktionsleisten

Öffne **Fenster → Funktionsleisten** oder klicke mit rechts auf den Rahmen einer Leiste, um vorhandene Leisten anzupassen: verfügbare Einträge hinzufügen oder entfernen, umsortieren, Trennlinien einfügen und die Symbolgröße wählen. Auch Eigenschaften- und Textleiste nutzen dieses Layoutsystem; ihre Felder bearbeiten weiterhin dieselben Funktionswerte.

Ziehe eine Leiste am Griff, um sie zu verschieben, an einem der vier Ränder anzudocken oder innerhalb der App frei zu platzieren. Die Kante bestimmt ihre Ausrichtung: oben/unten waagerecht, seitlich senkrecht. Schwebende Leisten behalten ihre letzte Ausrichtung. Lege sie nahe einer Zeilengrenze ab, um eine neue Zeile zwischen vorhandenen Zeilen einzufügen. Die Zeilen- oder Spaltenzahl innerhalb einer Leiste stellst du im Anpassen-Dialog ein; nicht passender Inhalt scrollt intern. Andere Leisten und der Arbeitsbereich gleiten innerhalb von 150 ms an ihre Position, sofern reduzierte Bewegung nicht aktiviert ist.

Knopfgruppen belegen einen Platz. Der Hauptknopf führt die aktuelle Aktion aus; ▾, Rechtsklick oder **350 ms Gedrückthalten** des Hauptknopfs öffnen die Gruppe. Ziehe die offene Gruppe am Griff heraus, um sie abzulösen. Abgelöste Gruppe und Quelle teilen sich die aktuelle Auswahl; erneutes Öffnen holt die vorhandene Gruppe nach vorn. Ihr **×** bringt sie in die Quellleiste zurück. Ausblenden der Quellleiste blendet auch ihre abgelösten Gruppen aus; Einblenden stellt sie wieder her.

**Leistenlayout sperren** verhindert Layoutänderungen und wird global gespeichert (anfangs ausgeschaltet). Ein abgeschlossener Ablegevorgang wird sofort gespeichert. **Esc**, Verlust des Fensterfokus oder Abbruch der Zeigereingabe brechen Verschieben oder Ablösen ohne Speichern ab.

- **Leistenlayout zurücksetzen** stellt Positionen, Ausrichtung, Zeilen/Spalten und Sichtbarkeit wieder her und bringt abgelöste Gruppen zurück; Belegungen und Symbolgrößen bleiben erhalten. Zahlen-, Text- und andere Funktionswerte werden nicht gelöscht.
- **Alle Belegungen zurücksetzen** stellt eingebaute Belegungen und Gruppenauswahl wieder her; eigene Leisten/Gruppen, Positionen und Symbolgrößen bleiben erhalten. **Standard wiederherstellen** stellt die Belegung der ausgewählten Leiste und die ursprünglichen Mitglieder ihrer eingebauten Gruppen wieder her. Gemeinsam verwendete Gruppen ändern sich in allen beteiligten Leisten.

Eigene Leisten kannst du im Anpassen-Dialog erstellen, umbenennen oder löschen; eingebaute Leisten sind nicht löschbar. Rücke eine Aktion unter die vorherige Aktion ein, um eine flache Knopfgruppe zu bilden. Eingebaute und eigene Gruppen bieten dieselbe Mitgliederbearbeitung: hinzufügen/entfernen, ein-/ausrücken und umsortieren. Abschnitte mit Funktionsfeldern sind keine Aktionsgruppen. Freie Leisten bleiben innerhalb der App statt in eigenen Betriebssystemfenstern. Arbeitsbereichsprofile und eine Neugestaltung von Symbolen oder Schriften sind nicht enthalten.

**Fenster → Fenster und Leisten zurücksetzen** stellt die ursprüngliche Anordnung wieder her.

## Maus und Tastatur

Zoomen mit dem Mausrad, Verschieben mit der Leertaste oder der mittleren Maustaste. Verschieben durch Ziehen mit der rechten Maustaste lässt sich unter **Bearbeiten → Einstellungen → Maus und Tastatur** einschalten. Alle Tasten stehen unter [Tastenkürzel](../reference/keyboard-shortcuts.md).

## Einstellungen auf einen anderen Rechner übertragen

**Datei → Einstellungen übertragen …** exportiert Einstellungen, Geräte, Material-Bibliothek, Bibliothek, Vorlagen, Erweiterungen und Fensteranordnung (jeweils auswählbar) in eine `.kzs`-Datei. Bewahre sie als Sicherung auf oder importiere sie auf einem anderen Rechner und wähle, ob zusammengeführt oder ersetzt wird. Kamera-Kalibrierungen kommen nur mit, wenn du sie auswählst.

## Rechner synchron halten

Die Desktop-App kann diese Einstellungen auch **über einen Ordner** deiner Wahl synchronisieren, etwa iCloud Drive, Dropbox, Nextcloud, OneDrive oder ein Netzlaufwerk. Jeder Rechner schreibt nur seine eigene Datei in den Unterordner „KizamuBeam“, so entstehen keine Konfliktkopien. Für jeden Eintrag gewinnt die neueste Änderung, und auch Löschungen werden übertragen.

## Updates

Die Desktop-App sucht nach neuen Versionen und bietet an, sie zu installieren. Unter **Bearbeiten → Einstellungen → Allgemein → Update-Kanal** wählst du **Stabil** oder **Nightly** (nächtliche Builds und Release-Kandidaten).
