---
sidebar_position: 6
title: Estensioni
description: Installare pacchetti di estensione con modelli di dispositivo, modelli di progetto, materiali e motivi.
---

# Estensioni

I pacchetti di estensione (file `.kzp`) aggiungono a KizamuBeam **modelli di dispositivo, modelli di progetto, voci della libreria materiali ed elementi della libreria** (motivi, immagini, elementi grafici), senza una nuova versione dell’app.

## Installare un’estensione

1. Apri **File → Estensioni …**.
2. Scegli un pacchetto dal **catalogo ufficiale** e installalo con un clic, oppure fai clic su **Installa …** e scegli un file `.kzp`. Puoi anche trascinare un file `.kzp` sull’area di lavoro.
3. La finestra mostra il contenuto del pacchetto e se si tratta di un aggiornamento. Conferma l’installazione.

Dopo l’installazione:

- i modelli compaiono in **File → Nuovo dal modello … → Dalle estensioni**,
- i modelli di dispositivo compaiono nell’elenco dei dispositivi, contrassegnati con il nome del pacchetto,
- i materiali vengono copiati nella libreria materiali,
- motivi ed elementi grafici compaiono nella libreria.

Rimuovendo un pacchetto nella stessa finestra, le sue voci spariscono di nuovo.

## Sicurezza

Un pacchetto contiene solo dati, mai codice. KizamuBeam controlla ogni voce prima dell’installazione, e i modelli di dispositivo dei pacchetti non possono portare script di inizio o fine né altri comandi per la tua macchina. Il catalogo ufficiale è firmato, e ogni pacchetto al suo interno viene verificato con il suo checksum.

## Estensioni ufficiali e di terze parti

Il catalogo ufficiale viene pubblicato insieme a questo manuale e al sito web, e **File → Estensioni …** ne mostra sempre lo stato attuale. Contiene questi pacchetti:

| Pacchetto | Contenuto | Richiede |
|---|---|---|
| **Example pack** (`org.kizamubeam.example`) | Un elemento per ogni tipo di contenuto: un profilo dispositivo (laser GRBL 300 × 200), due voci di materiale (taglio e incisione per compensato di pioppo), un modello (sottobicchiere rotondo con una riga di testo) e tre elementi della libreria (cuore, doppia cornice, stella). I valori sono esempi, non impostazioni misurate. | KizamuBeam 1.2.1 o successivo |

Il pacchetto di esempio è pensato come punto di partenza per i tuoi pacchetti. I pacchetti di altri autori compaiono qui quando sono stati verificati e aggiunti al catalogo. Fino ad allora installa pacchetti di terze parti solo da fonti di cui ti fidi: KizamuBeam ne controlla il contenuto, ma non può sapere se le impostazioni sono adatte alla tua macchina.

## Creare un pacchetto

Un pacchetto è un singolo file JSON. Il formato è descritto nella documentazione per sviluppatori: [Extension packs](https://github.com/negurvulkan/kizamubeam/blob/main/docs/packs.md) (in inglese). I pacchetti per il catalogo ufficiale si propongono con una pull request nella cartella [`packs/`](https://github.com/negurvulkan/kizamubeam/tree/main/packs).
