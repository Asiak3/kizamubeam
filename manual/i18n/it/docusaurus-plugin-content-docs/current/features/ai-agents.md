---
sidebar_position: 20
title: Agenti IA (MCP)
description: Lascia che un assistente IA come Claude legga e modifichi il tuo progetto tramite il Model Context Protocol, mentre tu mantieni il controllo del laser.
---

# Agenti IA (MCP)

KizamuBeam può essere controllato da un assistente IA tramite il **Model Context Protocol (MCP)**. L’assistente può leggere il progetto, disegnare, eseguire generatori, controllare il progetto e, se lo permetti, chiedere di avviare il laser. Ogni azione sulla macchina richiede comunque la tua conferma in KizamuBeam.

## Attivare

Apri **File → Agenti IA (MCP)…**. L’accesso è disattivato per impostazione predefinita.

1. Attiva il server. Funziona solo sul tuo computer, all’indirizzo `http://127.0.0.1:47800/mcp`, e non è raggiungibile dalla rete.
2. Scegli il livello di accesso (vedi sotto).
3. Copia il token e la configurazione nel tuo client IA.

Per i client che parlano solo stdio, avvia il ponte con `kizamubeam --mcp-stdio`.

## Livelli di accesso

| Livello | L’assistente può |
|---|---|
| **Solo lettura** | leggere documento, livelli, materiali, dispositivi e font, ottenere un’immagine di anteprima e una stima del tempo |
| **Leggi e progetta** | inoltre creare e modificare oggetti: forme, testo, codici QR e codici a barre, operazioni booleane, offset, strumenti per i percorsi, array, nesting, giunzioni, cerniere viventi, riempimento con motivo, generatori, modelli 3D, parametri, modelli, la libreria, serie, livelli, pagine e file |
| **Genera anche il G-code** | inoltre creare G-code, senza inviarlo alla macchina |
| **Controlla anche il laser** | inoltre collegare, mettere in pausa, fermare e richiedere un lavoro, un frame o un azzeramento |

Il livello laser vale solo fino alla chiusura di KizamuBeam.

## Sicurezza

- Un assistente non invia mai G-code grezzo al laser. Può solo *richiedere* un lavoro, un frame o un azzeramento, che parte solo dopo la tua conferma in KizamuBeam.
- I lavori devono restare nell’area di lavoro e nei limiti del dispositivo.
- Pausa e arresto funzionano sempre.
- Ogni azione sulla macchina viene registrata.

## Annullare

Ogni chiamata dell’assistente è un passo nella cronologia di annullamento, con il nome dello strumento usato. Torna indietro con **Ctrl+Z** o con la finestra Cronologia.

## Idee

- “Crea una scatola a giunzioni a dita con misure interne 120 × 80 × 60 mm in compensato da 3 mm.”
- “Controlla il progetto e correggi quello che puoi.”
- “Metti i nomi di questo elenco su targhette, una pagina ciascuna.”
- “Trasforma questo file STL in un modello a nervature.”
