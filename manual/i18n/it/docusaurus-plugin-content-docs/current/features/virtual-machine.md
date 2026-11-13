---
sidebar_position: 18
title: Macchina virtuale
description: Prova lavori, funzioni della fotocamera e Stampa e taglia senza hardware con la KizamuBeam Virtual Machine.
---

# Macchina virtuale

La **KizamuBeam Virtual Machine** è un programma separato (un download separato nella [pagina delle release](https://github.com/negurvulkan/kizamubeam/releases)) che si comporta come un laser con controller FluidNC 3.7 o GRBL 1.1. Usala per imparare KizamuBeam, per provare un lavoro prima di sprecare materiale o per provare le funzioni della fotocamera senza fotocamera.

## Collegarsi

1. Avvia la Virtual Machine.
2. In KizamuBeam aggiungi un dispositivo dal modello **KizamuBeam Virtual Machine** e collegati.

La Virtual Machine è in ascolto su Telnet (porta 2323) e WebSocket (porta 8181). Le porte si possono cambiare, e la macchina può essere raggiungibile anche dalla rete. Altri programmi si collegano a essa come dispositivo di rete GRBL o FluidNC.

## Cosa mostra

- **Vista dall’alto**: il piano con i segni di bruciatura (più scuri con più potenza), i movimenti rapidi e la testa con il punto laser.
- **Vista 3D**: piano, telaio, portale, testa laser e raggio. Posiziona pezzi con dimensioni, spessore, posizione e uno dei 21 aspetti di materiale. Ogni linea brucia nel materiale in tempo reale: passate più lente o più forti risultano più scure e profonde, e dove l’energia basta il materiale viene tagliato da parte a parte.
- **Pezzi**: appena una forma è tagliata tutto intorno, diventa un pezzo libero. Estrailo, giralo e osservalo da vicino. Un pezzo ancora attaccato in un punto non tagliato del tutto viene segnato in arancione.
- **Stato**: posizioni, override, pianificatore, tempo di esecuzione, connessioni e una console.

Il modello di bruciatura è tarato su un laser a diodo da 10 W (100 % a 300 mm/min taglia 3 mm di compensato). È un modello, non una misura, quindi i materiali reali richiedono comunque un [test del materiale](materials-tests.md#material-test).

## Come una macchina vera

La Virtual Machine emula il buffer di ricezione, il pianificatore di movimento con accelerazione, i comandi in tempo reale (sospendi, riprendi, reset, override, air assist), azzeramento, movimento, offset di lavoro e allarmi. Ti avvisa quando un programma riempie troppo il buffer di ricezione, e se la testa urta il telaio perde la posizione come una macchina vera. **Power cycle** la spegne e la riaccende.

## Fotocamera virtuale

La Virtual Machine genera un’immagine della fotocamera della sua scena 3D, da sopra il piano o dalla testa laser, e la fornisce come una fotocamera di rete (stream MJPEG su `http://…:8282/stream`). In KizamuBeam aggiungila come fotocamera di rete nella finestra [Fotocamera](camera.md) per provare calibrazione, riconoscimento dei pezzi e [Stampa e taglia](print-and-cut.md) senza hardware.

## Modalità Ruida

La Virtual Machine può anche rispondere come un controller Ruida (usato in molti laser CO2) via UDP. Serve per provare altri programmi che parlano Ruida; KizamuBeam stesso non supporta ancora i controller Ruida.

## Finestra

La barra laterale si può allargare, nascondere (Ctrl+B, ⌘B su Mac) e mettere a sinistra o a destra. Tema e lingua sono in **Settings → View** (la Virtual Machine è disponibile in inglese e tedesco).
