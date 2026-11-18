---
sidebar_position: 3
title: Compatibilità delle macchine
description: Quali laser e controller funzionano con KizamuBeam.
---

# Compatibilità delle macchine

KizamuBeam comunica direttamente con il controller del tuo laser e invia G-code o lavori binari Ruida `.rd`. Funziona con la maggior parte dei laser a diodo e laser CO₂ il cui controller usa uno di questi firmware:

| Firmware | Connessione | Note |
|---|---|---|
| **FluidNC** | USB, Wi-Fi (Telnet, WebSocket) | Editor della configurazione, lavori dalla scheda SD o dalla memoria flash del controller, ricerca in rete |
| **GRBL 1.1** | USB, Wi-Fi se il controller lo offre | Stato in tempo reale e override |
| **grblHAL** | USB, rete | Come GRBL |
| **Marlin** | USB | Invio riga per riga; posizione tramite M114 |
| **Smoothieware** | USB | Invio riga per riga; potenza da 0 a 1 |
| **xTool (USB)** | USB | Famiglia xTool D1; riconosciuto dalla procedura guidata. Lo stato viene letto solo a riposo, quindi il lavoro risulta finito quando l'ultima riga è stata accettata. Non ancora provato su hardware |
| **Ruida DSP** | Rete (UDP 50200/50207), seriale USB, esportazione file `.rd` | RDC6442G/S, RDC6445G, RDC6332G, KT332N e controller CO₂ compatibili; esportazione/importazione binaria `.rd`, controllo diretto, salvataggio di lavori con nome nella memoria del controller, frame e spostamento |

Sono supportati assi rotanti (a rulli o a mandrino, sulla porta Y o come asse separato), asse Z motorizzato e assistenza aria.

## Modelli di dispositivo

Quando crei un dispositivo, i modelli per i laser più diffusi compilano area di lavoro e impostazioni, per esempio Swiitol, Ortur, Atomstack, Sculpfun, xTool, Creality Falcon, Two Trees, Longer, Comgrow, OMTech e Ruida. Per qualsiasi altro laser scegli il modello generico del suo controller. La [procedura guidata](../getting-started/connect-laser.md) legge poi i valori reali dalla macchina.

## Non (ancora) supportati

- **Altri controller DSP** (come Trocen/AWC, TopWisdom o Leetro): non ancora supportati.
- **Laser galvo**: non supportati.
- **Laser con protocolli proprietari**, come alcuni modelli xTool che comunicano solo con il protocollo di rete del produttore.

## Provati dagli utenti

Le esperienze con macchine reali aiutano gli altri. Raccontaci su [Discord](https://discord.gg/SSr8VHh7EJ) o in una [issue su GitHub](https://github.com/KizamuBeam/kizamubeam/issues) quale laser usi con KizamuBeam e come funziona.
