---
sidebar_position: 12
title: Eseguire lavori e controllare la macchina
description: Avvia, contorna e visualizza in anteprima i lavori, scegli dove inizia un lavoro, regola potenza e velocità durante la lavorazione e configura i dispositivi.
---

# Eseguire lavori e controllare la macchina

Questa pagina descrive tutto ciò che succede dopo il progetto. Come collegare un laser la prima volta è spiegato in [Collegare un laser](../getting-started/connect-laser.md).

Le finestre della macchina stanno a destra per impostazione predefinita: **Laser** (lavoro, stato, dispositivi), **Sposta** (movimento e origine) e **Console**.

## Anteprima

**Laser → Anteprima …** (Alt+P) simula il lavoro prima che qualcosa si muova:

- riproduzione con cursore del tempo, spostamenti a vuoto e ombreggiatura secondo la potenza,
- una stima del tempo che considera accelerazione e angoli,
- lo stesso ordine del lavoro reale.

**Inizia qui** esegue il lavoro dalla posizione del cursore del tempo, per esempio dopo un’interruzione. La testa si sposta lì con il laser spento e prosegue con potenza, velocità e air assist di quel livello.

## Frame

**Frame** percorre il rettangolo intorno al lavoro, **Frame del contorno** ne segue il contorno. Entrambi possono usare il laser a bassa potenza, così vedi il frame sul materiale. Usa il frame per verificare che il lavoro stia sul pezzo prima di iniziare.

## Avviare, mettere in pausa e fermare

**Avvia** invia il lavoro. Durante il lavoro la finestra Laser mostra avanzamento, tempo trascorso e tempo rimanente.

- **Pausa** ferma la macchina; **Riprendi** continua.
- **Arresta** interrompe il lavoro e reimposta il controller. La posizione viene mantenuta.
- **Taglia solo la grafica selezionata** lavora solo gli oggetti selezionati.

Prima di ogni lavoro e di ogni frame, KizamuBeam verifica che tutti i movimenti, overscan compreso, restino nell’area di lavoro della macchina. Se il controller non ha ancora comunicato la sua origine (o non lo fa mai, come Marlin), un avviso mostra l’estensione del lavoro, che devi confermare.

## Dove inizia il lavoro

L’impostazione **Inizia da** nella finestra Laser decide dove finisce il lavoro:

| Inizia da | Significato |
|---|---|
| **Coordinate assolute** | Il lavoro sta esattamente dove si trova nell’area di lavoro. L’area di lavoro è il piano della macchina. Richiede l’azzeramento. |
| **Origine utente** | Il lavoro inizia in un’origine che imposti con la finestra Sposta. |
| **Posizione attuale** | Il lavoro inizia dove si trova ora la testa. |

Con Origine utente e Posizione attuale, l’**origine del lavoro** (nove punti: angoli, centri dei lati, centro) indica quale punto del lavoro si trova in quella posizione.

## Regolare durante la lavorazione

**Regola** nella finestra Laser cambia potenza e velocità a passi di 1 e 10 % (da 10 a 200 %) e i movimenti rapidi al 25, 50 o 100 %, mentre il lavoro è in corso. L’air assist si attiva e disattiva subito, anche durante un lavoro. Funziona con GRBL, grblHAL e FluidNC.

## Ordine di taglio

La finestra Laser ha tre opzioni per l’ordine dei tagli. I livelli vengono sempre lavorati nell’ordine della tabella dei livelli.

| Opzione | Effetto |
|---|---|
| **Prima le forme interne** | Fori e contorni interni vengono tagliati prima del loro contorno esterno, così i pezzi non cadono prima che i fori siano tagliati. |
| **Riduci gli spostamenti a vuoto** | Viene tagliata per prima la forma più vicina. Se disattivata, vale l’ordine della finestra Oggetti (ordine manuale). |
| **Mantieni uniti i gruppi** | Le forme dello stesso oggetto o gruppo vengono tagliate preferibilmente una dopo l’altra. |

Per scegliere dove inizia un singolo taglio e in che direzione, usa lo strumento del punto iniziale (vedi [Percorsi e forme](paths.md)).

## Finestra Sposta

La finestra **Sposta** muove la testa a passi, imposta e cancella l’origine utente, sblocca la macchina dopo un allarme, esegue l’azzeramento e sposta la testa:

- **Sposta il laser alla selezione** porta la testa agli oggetti selezionati.
- **Sposta laser al clic**: finché il pulsante è attivo, ogni clic sull’area di lavoro porta lì la testa con il laser spento. Esc termina la modalità.

## Console

La **Console** mostra i messaggi del controller e permette di inviare comandi, con cronologia. Allarmi e ingressi attivi (finecorsa, sportello, sonda) vengono spiegati in modo comprensibile.

## Salvare il G-code

**Laser → Salva GCode …** scrive il lavoro in un file, per esempio per eseguirlo da una scheda SD o con un altro programma.

## Dispositivi e impostazioni del dispositivo

Ogni laser è un **dispositivo** con connessione, area di lavoro e impostazioni proprie. Scegli il dispositivo in cima alla finestra Laser o gestisci i dispositivi in **Laser → Dispositivo → Dispositivi …**. I nuovi dispositivi possono partire da modelli per i laser più diffusi.

**Laser → Dispositivo → Impostazioni dispositivo …** contiene, tra l’altro:

- area di lavoro, valore S per il 100 % di potenza, baud rate, indirizzo di rete,
- velocità dei movimenti rapidi e accelerazione (**Leggi dalla macchina** le legge da FluidNC o GRBL),
- dimensione del buffer di ricezione,
- finecorsa (con “Nessuna”, KizamuBeam non esegue mai l’azzeramento da solo e chiede prima di farlo),
- asse Z motorizzato (per l’offset Z per passaggio e il test del fuoco),
- comando dell’air assist (M8 o M7),
- **Script G-code**: comandi da eseguire prima e dopo ogni lavoro,
- **Puntatore punto rosso**: lo spostamento tra raggio e puntatore, così frame e spostamenti con clic possono mirare con il punto rosso,
- funzioni extra **FluidNC** (vedi sotto).

## Funzioni extra FluidNC

Con un controller FluidNC, **Laser → FluidNC** offre:

- **Eseguire il lavoro dalla scheda SD o dalla flash**: carica prima il lavoro ed eseguilo lì, così un’interruzione del Wi-Fi non lo ferma. Pausa e arresto funzionano come al solito.
- **File sul controller**: elencare, caricare, eseguire ed eliminare file.
- **Configurazione …**: leggere, cercare e modificare il config.yaml, provare valori o salvarli e riavviare. Ogni salvataggio conserva una copia dello stato precedente (le ultime dieci per dispositivo), che puoi ripristinare.
- **Uscite**: le uscite libere (per esempio un aspiratore) si possono attivare nella finestra Laser e accendere automaticamente durante ogni lavoro.

## Controller

KizamuBeam funziona con FluidNC, GRBL 1.1, grblHAL, Marlin e Smoothieware. I pulsanti per azzeramento, movimento, origine e console si adattano al controller. Dettagli e laser provati in [Compatibilità delle macchine](../reference/machine-compatibility.md).

## Asse rotante e laser remoti

- Incidere cilindri: vedi [Asse rotante](rotary.md).
- Usare un laser collegato a un altro computer: vedi [Controllo remoto](remote-control.md).
- Provare tutto senza laser: vedi [Macchina virtuale](virtual-machine.md).
