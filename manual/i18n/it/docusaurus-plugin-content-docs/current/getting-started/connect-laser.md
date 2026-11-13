---
sidebar_position: 4
title: Collegare un laser
description: Collegare un laser GRBL, grblHAL, FluidNC, Marlin o Smoothieware via USB o Wi-Fi con la procedura guidata.
---

# Collegare un laser

KizamuBeam funziona con i laser il cui controller usa **FluidNC, GRBL, grblHAL, Marlin o Smoothieware**. Questo copre la maggior parte dei laser a diodo. I dettagli sono in [Compatibilità delle macchine](../reference/machine-compatibility.md).

## La procedura guidata Configurazione laser

Il modo più semplice è la procedura guidata: **Laser → Configurazione laser …**, o il pulsante nella finestra Laser. Al primissimo avvio dell’app si apre da sola. Ti guida in cinque passi dalla prima connessione a un primo lavoro di prova sicuro.

```mermaid
flowchart LR
  A[1. Connetti] --> B[2. Rileva]
  B --> C[3. Controlla]
  C --> D[4. Muovi]
  D --> E[5. Lavoro di prova]
```

1. **Connetti**: scegli un modello di dispositivo per il tuo laser o uno generico per il tuo controller, poi USB o rete, e connettiti. KizamuBeam non esegue mai l’homing durante la connessione.
2. **Rileva**: KizamuBeam chiede al controller firmware e versione e legge le sue impostazioni, come area di lavoro, scala della potenza e modalità laser.
3. **Controlla**: i problemi vengono elencati in modo chiaro, per esempio un’area di lavoro diversa, la modalità laser disattivata o l’homing senza finecorsa. Le impostazioni in KizamuBeam si applicano con un clic. Le modifiche al controller vengono solo proposte, insieme al comando per annullarle, e inviate solo dopo la tua conferma.
4. **Muovi**: la testa si muove in X e Y con il laser spento, e tu indichi dove è andata. Per un asse invertito viene proposta una correzione.
5. **Lavoro di prova**: un piccolo quadrato con un cerchio a bassa potenza, con anteprima e frame. Parte solo dopo che hai confermato materiale e messa a fuoco, frame, occhiali di protezione e aspirazione.

## USB

Collega il laser con un cavo USB, scegli **USB** nella procedura guidata o nella finestra Laser e seleziona la porta. Il baud rate si imposta nelle impostazioni del dispositivo (115200 per la maggior parte dei controller).

- **Windows**: alcuni controller richiedono un driver USB (spesso CH340 o CP210x) del produttore del laser.
- **Linux**: il tuo utente deve poter accedere alle porte seriali, vedi [Installazione](installation.md#linux).

## Wi-Fi

I controller con Wi-Fi, come FluidNC, si raggiungono in rete:

- **Telnet** sulla porta 23, oppure
- **WebSocket** sulla porta 81 (FluidNC; se la 81 non risponde viene provata la 80).

Inserisci l’indirizzo del controller, per esempio `192.168.1.50` o `fluidnc.local`. **Cerca …** accanto al campo dell’indirizzo trova i controller FluidNC nella tua rete locale.

:::tip Wi-Fi instabile
Con FluidNC un lavoro può essere caricato sulla scheda SD o sulla memoria flash del controller ed eseguito da lì (**Laser → FluidNC**). Un’interruzione del Wi-Fi non ferma più il lavoro.
:::

## Più dispositivi

Ogni laser viene salvato come dispositivo con area di lavoro, connessione e impostazioni proprie. Puoi passare dall’uno all’altro in cima alla finestra Laser o in **Laser → Dispositivo → Dispositivi …**. Esistono modelli di dispositivo per molti laser diffusi (per esempio Swiitol, Ortur, Atomstack, Sculpfun, xTool, Creality Falcon, Two Trees, Longer e Comgrow); l’area di lavoro mostra sempre il piano del dispositivo selezionato.

## Senza laser

La **KizamuBeam Virtual Machine** è un programma separato che si comporta come un controller FluidNC o GRBL e mostra il lavoro in 3D, inciso su materiale virtuale. Scaricala dalla [pagina delle release](https://github.com/negurvulkan/kizamubeam/releases?q=vm-v) e connettiti con il modello di dispositivo “KizamuBeam Virtual Machine”.
