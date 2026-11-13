---
sidebar_position: 17
title: Controllo remoto
description: Usa un laser collegato a un altro computer con KizamuBeam, tramite la rete di casa o una VPN.
---

# Controllo remoto

Spesso il laser sta in laboratorio, mentre tu progetti alla scrivania. Con il controllo remoto, il computer accanto al laser esegue KizamuBeam in **modalità host**, e gli altri computer usano quel laser come se fosse collegato a loro.

## Configurare l’host

Sul computer collegato al laser:

1. Collega il laser come al solito (vedi [Collegare un laser](../getting-started/connect-laser.md)).
2. Scegli **Laser → Controllo remoto → Modalità host …** e attiva la modalità host. È disattivata per impostazione predefinita.
3. Se vuoi, spunta **Conferma gli avvii remoti su questo computer**, così ogni avvio remoto va confermato accanto al laser.

L’host è in ascolto sulla porta 47900. La connessione è cifrata.

## Associare un computer

Sull’altro computer:

1. Aggiungi un dispositivo (**Laser → Dispositivo → Dispositivi …**) con la connessione **Altro KizamuBeam (rete)**.
2. Fai clic su **Cerca host …** per trovare gli host nella rete, oppure inserisci l’indirizzo dell’host (tramite una VPN come Tailscale o WireGuard, a mano).
3. Fai clic su **Associa …**. L’host mostra un codice di 6 cifre; digitalo su questo computer.

L’host elenca tutti i computer associati e può rimuoverli o cambiarne il ruolo:

| Ruolo | Può |
|---|---|
| **Operatore** | spostare, eseguire il frame, avviare, mettere in pausa e fermare |
| **Spettatore** | solo guardare stato, avanzamento e console |

## Eseguire lavori a distanza

**Avvia** non invia G-code. Invia il progetto (livelli, impostazioni di taglio, immagini) e i font usati. L’host calcola il lavoro con le proprie impostazioni del dispositivo e lo esegue tramite la propria connessione. Prima che il laser parta vedi l’anteprima dell’host, il tempo stimato ed eventuali avvisi (area di lavoro, font mancanti, air assist).

Frame, frame del contorno, test del materiale, test del fuoco e il lavoro di prova della configurazione funzionano allo stesso modo. Movimento, azzeramento, console, regolazioni, pausa e arresto vanno direttamente alla macchina dell’host. Stato e avanzamento arrivano a ogni computer collegato, e un’interruzione di rete non interrompe mai un lavoro in corso: l’host continua. Chi sta all’host può sempre mettere in pausa o fermare.

Un avvio remoto viene rifiutato finché la macchina dell’host è occupata o non collegata. **Inizia qui** e G-code grezzo dal client non sono ancora possibili.

## Lavori remoti sull’host

**Laser → Controllo remoto → Lavori remoti …** elenca sull’host gli ultimi 20 lavori ricevuti con anteprima, mittente e ora. Riavviane uno (viene ricalcolato con le impostazioni attuali) oppure **Apri nell’editor** come progetto normale.

## Riprendere le impostazioni dall’host

**Laser → Controllo remoto → Importa dall’host …** copia le impostazioni del dispositivo dell’host sul tuo dispositivo (nome e connessione restano), unisce la libreria dei materiali dell’host e aggiunge le fotocamere dell’host con la loro calibrazione. L’immagine della fotocamera arriva allora tramite la connessione, con alcuni fotogrammi al secondo.
