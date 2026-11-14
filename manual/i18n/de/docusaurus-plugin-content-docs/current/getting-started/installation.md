---
sidebar_position: 1
title: Installation
description: KizamuBeam unter macOS, Windows und Linux herunterladen, installieren und aktuell halten.
---

# Installation

KizamuBeam ist kostenlos und braucht weder Konto noch Lizenzschlüssel. Lade den Installer für dein System von der [Release-Seite](https://github.com/negurvulkan/kizamubeam/releases) oder der [Website](https://negurvulkan.github.io/kizamubeam/#download) herunter.

| System | Datei |
|---|---|
| **macOS** (Apple Silicon und Intel) | `KizamuBeam_…_universal.dmg` |
| **Windows** (64 Bit) | `KizamuBeam_…_x64-setup.exe` |
| **Linux** (64 Bit) | `KizamuBeam_…_amd64.AppImage`, `.deb` oder `.rpm` |

## macOS

1. Öffne die `.dmg`-Datei und ziehe **KizamuBeam** in den Ordner **Programme**.
2. Starte KizamuBeam aus dem Ordner Programme.

Die App ist noch nicht von Apple beglaubigt. Beim ersten Start meldet macOS deshalb eventuell, dass sie nicht überprüft werden kann. Öffne **Systemeinstellungen → Datenschutz & Sicherheit**, scrolle nach unten und klicke auf **Dennoch öffnen**. Das ist nur einmal nötig.

:::tip Wenn „Dennoch öffnen“ nicht erscheint
Öffne das Terminal und gib ein:

```bash
xattr -cr /Applications/KizamuBeam.app
```

Starte KizamuBeam danach erneut.
:::

## Windows

1. Starte `KizamuBeam_…_x64-setup.exe`.
2. Warnt Windows SmartScreen vor einem unbekannten Herausgeber, klicke auf **Weitere Informationen → Trotzdem ausführen**. Der Installer ist noch nicht code-signiert, was bei jungen Open-Source-Projekten üblich ist.
3. Folge dem Installer. KizamuBeam erscheint danach im Startmenü.

## Linux

Wähle das Paket, das zu deiner Distribution passt:

- **AppImage** (jede Distribution): Datei ausführbar machen und starten.
  ```bash
  chmod +x KizamuBeam_*_amd64.AppImage
  ./KizamuBeam_*_amd64.AppImage
  ```
- **.deb** (Debian, Ubuntu, Linux Mint …):
  ```bash
  sudo apt install ./KizamuBeam_*_amd64.deb
  ```
- **.rpm** (Fedora, openSUSE …, nur stabile Versionen):
  ```bash
  sudo dnf install ./KizamuBeam-*.x86_64.rpm
  ```

:::note USB-Verbindung unter Linux
Damit KizamuBeam per USB mit dem Laser sprechen kann, braucht dein Benutzer meist Zugriff auf serielle Schnittstellen. Bei den meisten Distributionen heißt das: Mitglied der Gruppe `dialout` (bei Arch-basierten Systemen `uucp`). Danach einmal ab- und wieder anmelden:

```bash
sudo usermod -aG dialout $USER
```
:::

## Updates

KizamuBeam sucht nach neuen Versionen und aktualisiert sich selbst: **Hilfe → Nach Updates suchen …**. Unter **Bearbeiten → Einstellungen → Allgemein → Updates** wählst du den Update-Kanal:

- **Stabil**: nur fertige Versionen (empfohlen).
- **Nightly (mit Vorabversionen)**: jede Nacht ein neuer Build aus dem aktuellen Entwicklungsstand, dazu Release-Kandidaten vor jeder stabilen Version. Neue Funktionen früher ausprobieren und beim Finden von Fehlern helfen. Nightly-Builds sind **nicht an echter Hardware getestet**: Beobachte den ersten Job, und mit einem Nightly gespeicherte Dateien lassen sich in der stabilen Version eventuell nicht öffnen.

Wer bisher den Kanal Beta genutzt hat, wird auf Stabil umgestellt; Nightly wählst du bei Bedarf selbst.

## Wie geht es weiter?

- [Die Oberfläche](interface.md): ein Rundgang durch das Hauptfenster.
- [Laser verbinden](connect-laser.md): der Einrichtungsassistent öffnet sich beim allerersten Start von selbst.
