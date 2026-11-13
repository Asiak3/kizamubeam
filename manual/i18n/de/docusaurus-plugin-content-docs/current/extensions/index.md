---
sidebar_position: 6
title: Erweiterungen
description: Erweiterungspakete mit Gerätevorlagen, Projektvorlagen, Materialien und Motiven installieren.
---

# Erweiterungen

Erweiterungspakete (`.kzp`-Dateien) fügen KizamuBeam **Gerätevorlagen, Projektvorlagen, Einträge für die Materialbibliothek und Bibliothekselemente** (Motive, Bilder, Gestaltungselemente) hinzu, ohne neue App-Version.

## Eine Erweiterung installieren

1. Öffne **Datei → Erweiterungen …**.
2. Wähle ein Paket aus dem **offiziellen Katalog** und installiere es mit einem Klick, oder klicke auf **Installieren …** und wähle eine `.kzp`-Datei. Du kannst eine `.kzp`-Datei auch auf die Arbeitsfläche ziehen.
3. Der Dialog zeigt, was das Paket enthält und ob es ein Update ist. Bestätige die Installation.

Nach der Installation:

- erscheinen Vorlagen unter **Datei → Neu aus Vorlage … → Aus Erweiterungen**,
- erscheinen Gerätevorlagen in der Geräteliste, mit dem Paketnamen markiert,
- werden Materialien in die Materialbibliothek kopiert,
- erscheinen Motive und Gestaltungselemente in der Bibliothek.

Entfernst du ein Paket im selben Fenster, verschwinden seine Einträge wieder.

## Sicherheit

Ein Paket enthält nur Daten, nie Programmcode. KizamuBeam prüft jeden Eintrag vor der Installation, und Gerätevorlagen aus Paketen können keine Start- oder Endskripte oder andere Befehle für deine Maschine mitbringen. Der offizielle Katalog ist signiert, und jedes Paket darin wird gegen seine Prüfsumme geprüft.

## Offizielle Erweiterungen und Erweiterungen von Dritten

Der offizielle Katalog wird zusammen mit diesem Handbuch und der Website veröffentlicht. Eine Liste offizieller und geprüfter Erweiterungen von Dritten, mit Angaben zur Kompatibilität, folgt hier.

## Ein eigenes Paket bauen

Ein Paket ist eine einzelne JSON-Datei. Das Format steht in der Entwicklerdokumentation: [Extension packs](https://github.com/negurvulkan/kizamubeam/blob/main/docs/packs.md) (englisch). Pakete für den offiziellen Katalog reichst du als Pull Request für den Ordner [`packs/`](https://github.com/negurvulkan/kizamubeam/tree/main/packs) ein.
