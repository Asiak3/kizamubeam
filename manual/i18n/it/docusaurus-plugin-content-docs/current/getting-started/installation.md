---
sidebar_position: 1
title: Installazione
description: Scaricare, installare e aggiornare KizamuBeam su macOS, Windows e Linux.
---

# Installazione

KizamuBeam è gratuito e non richiede account né chiavi di licenza. Scarica il programma di installazione per il tuo sistema dalla [pagina delle release](https://github.com/negurvulkan/kizamubeam/releases) o dal [sito web](https://negurvulkan.github.io/kizamubeam/it/#download).

| Sistema | File |
|---|---|
| **macOS** (Apple Silicon e Intel) | `KizamuBeam_…_universal.dmg` |
| **Windows** (64 bit) | `KizamuBeam_…_x64-setup.exe` |
| **Linux** (64 bit) | `KizamuBeam_…_amd64.AppImage`, `.deb` o `.rpm` |

## macOS

1. Apri il file `.dmg` e trascina **KizamuBeam** nella cartella **Applicazioni**.
2. Avvia KizamuBeam dalla cartella Applicazioni.

L’app non è ancora autenticata da Apple, quindi al primo avvio macOS potrebbe dire che non può essere verificata. Apri **Impostazioni di Sistema → Privacy e sicurezza**, scorri verso il basso e fai clic su **Apri comunque**. Basta farlo una volta.

:::tip Se “Apri comunque” non compare
Apri il Terminale ed esegui

```bash
xattr -cr /Applications/KizamuBeam.app
```

Poi avvia di nuovo KizamuBeam.
:::

## Windows

1. Esegui `KizamuBeam_…_x64-setup.exe`.
2. Se Windows SmartScreen avvisa di un editore sconosciuto, fai clic su **Ulteriori informazioni → Esegui comunque**. Il programma di installazione non è ancora firmato digitalmente, cosa comune per i giovani progetti open source.
3. Segui il programma di installazione. KizamuBeam compare poi nel menu Start.

## Linux

Scegli il pacchetto adatto alla tua distribuzione:

- **AppImage** (qualsiasi distribuzione): rendi eseguibile il file e avvialo.
  ```bash
  chmod +x KizamuBeam_*_amd64.AppImage
  ./KizamuBeam_*_amd64.AppImage
  ```
- **.deb** (Debian, Ubuntu, Linux Mint …):
  ```bash
  sudo apt install ./KizamuBeam_*_amd64.deb
  ```
- **.rpm** (Fedora, openSUSE …, solo versioni stabili):
  ```bash
  sudo dnf install ./KizamuBeam-*.x86_64.rpm
  ```

:::note Connessione USB su Linux
Per comunicare con un laser via USB, di solito il tuo utente deve poter accedere alle porte seriali. Sulla maggior parte delle distribuzioni significa far parte del gruppo `dialout` (sui sistemi basati su Arch `uucp`). Dopo averlo aggiunto, esci e rientra:

```bash
sudo usermod -aG dialout $USER
```
:::

## Aggiornamenti

KizamuBeam cerca le nuove versioni e si aggiorna da solo: **Aiuto → Controlla aggiornamenti …**. In **Modifica → Impostazioni → Generale → Aggiornamenti** scegli il canale di aggiornamento:

- **Stabile**: solo versioni definitive (consigliato).
- **Nightly (incluse versioni preliminari)**: ogni notte una nuova build dallo stato di sviluppo attuale, più le release candidate prima di ogni versione stabile. Prova prima le nuove funzioni e aiuta a trovare i bug. Le build nightly **non sono testate su hardware reale**: osserva il primo lavoro; i file salvati con una build nightly potrebbero non aprirsi nella versione stabile.

Chi usava il canale Beta passa a Stabile; scegli Nightly tu stesso se lo desideri.

## Prossimi passi

- [L’interfaccia](interface.md): un giro nella finestra principale.
- [Collegare un laser](connect-laser.md): la procedura guidata si apre da sola al primo avvio.
