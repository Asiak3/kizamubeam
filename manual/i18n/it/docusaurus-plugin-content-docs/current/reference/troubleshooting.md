---
sidebar_position: 4
title: Risoluzione dei problemi
description: Soluzioni ai problemi più comuni durante l’installazione di KizamuBeam e la connessione di un laser.
---

# Risoluzione dei problemi

## Installazione

**macOS dice che l’app non può essere verificata o è danneggiata.**
L’app non è ancora autenticata da Apple. Apri **Impostazioni di Sistema → Privacy e sicurezza** e fai clic su **Apri comunque**, oppure esegui `xattr -cr /Applications/KizamuBeam.app` nel Terminale. Vedi [Installazione](../getting-started/installation.md#macos).

**Windows SmartScreen blocca il programma di installazione.**
Fai clic su **Ulteriori informazioni → Esegui comunque**. Il programma di installazione non è ancora firmato digitalmente.

## Connessione

**La porta USB non compare.**
- Prova un altro cavo: alcuni cavi USB servono solo per la ricarica e non trasmettono dati.
- Chiudi gli altri programmi che potrebbero tenere occupata la porta (un altro software laser, un terminale seriale).
- Windows: installa il driver USB per il tuo controller (spesso CH340 o CP210x).
- Linux: aggiungi il tuo utente al gruppo `dialout`, poi esci e rientra.

**Il laser non viene trovato via Wi-Fi.**
- Computer e laser devono essere nella stessa rete.
- Inserisci l’indirizzo IP del controller invece di un nome come `fluidnc.local`.
- Con FluidNC prova **Cerca …** accanto al campo dell’indirizzo, oppure passa da Telnet a WebSocket.

**La macchina segnala un allarme dopo la connessione.**
Molti controller partono in stato di allarme finché non viene eseguito l’homing o lo sblocco. Esegui l’homing se la macchina ha i finecorsa, altrimenti sbloccala nella finestra Sposta. La finestra Laser spiega l’allarme in modo chiaro.

## Incisione

**Il laser si muove ma non si accende, o solo a piena potenza.**
La scala della potenza in KizamuBeam (valore S per il 100 %) deve corrispondere al controller (`$30` su GRBL), e la modalità laser deve essere attiva (`$32=1`). La [procedura guidata](../getting-started/connect-laser.md) rileva entrambe le cose e propone di correggerle.

**Un asse si muove nella direzione sbagliata.**
Esegui il passo 4 (“Muovi”) della procedura guidata. Rileva un asse invertito e propone l’impostazione corretta.

**KizamuBeam dice che il lavoro non entra nel piano.**
Prima di ogni lavoro KizamuBeam controlla tutti i movimenti rispetto all’area di lavoro. Controlla nella finestra Laser l’origine del lavoro e la modalità di avvio (coordinate assolute, origine utente o posizione attuale), e l’area di lavoro nelle impostazioni del dispositivo.

**Il lavoro si interrompe quando cade il Wi-Fi.**
Con FluidNC carica il lavoro sul controller ed eseguilo da lì (**Laser → FluidNC**).

## Ancora bloccato?

Chiedi su [Discord](https://discord.gg/SSr8VHh7EJ) o apri una [issue su GitHub](https://github.com/negurvulkan/kizamubeam/issues). Indica sistema operativo, versione di KizamuBeam, laser e firmware.
