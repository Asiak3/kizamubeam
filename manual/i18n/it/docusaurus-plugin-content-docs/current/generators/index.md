---
title: Generatori
description: I generatori creano parti finite a partire da poche misure, come scatole, ingranaggi e modelli a incastro, e le mantengono modificabili.
---

# Generatori

I generatori creano parti finite a partire da poche misure, invece di disegnarle a mano. Si trovano tutti nella **Casella degli strumenti** (**Strumenti → Casella degli strumenti …**, **Finestra → Casella degli strumenti** oppure il pulsante a riquadri nella barra Strumenti), divisi in gruppi e con una ricerca.

| Pagina | Generatori |
|---|---|
| [Ingranaggi e cremagliere](gears.md) | Ingranaggio, coppia di ingranaggi, cremagliera |
| [Pulegge e camme](pulleys-cams.md) | Puleggia dentata, camma a disco |
| [Scatole con giunzioni a dita](boxes.md) | Scatola con giunzioni a dita, scatola con giunti a pettine e divisori |
| [Cassetti, inserti e scaffali](drawers-shelves.md) | Cassetto, inserto divisorio, ripiano a incastro |
| [Modelli a strati e a nervature](models-3d.md) | Modello a strati e modello a nervature da un file STL o OBJ |
| [Sfera a dischi](disc-sphere.md) | Una sfera o un paralume fatto di dischi a incastro |
| [Lavoro multistrato](multilayer.md) | Le tue forme sovrapposte in un rilievo a strati |

Le giunzioni tra le tue forme, la cerniera del coperchio, le cerniere viventi e le asole sono strumenti, non generatori: vedi [Giunzioni, cerniere e vista 3D](../features/construction-3d.md). Le dime sono descritte in [Print and Cut e dime](../features/print-and-cut.md#jigs), gli schizzi quotati in [Aggancio, guide e misure](../features/precision.md#sketches-with-dimensions).

## Lavorare con i generatori

### Crea e Aggiungi

Ogni finestra di un generatore mostra un’anteprima dal vivo e controlla i valori mentre li digiti; i problemi compaiono in rosso o arancione sotto i campi. Le impostazioni usate di rado si trovano in **Avanzate**.

- **Crea** genera la parte e chiude la finestra.
- **Aggiungi** genera la parte e lascia la finestra aperta, così puoi preparare la successiva con altri valori. Quando modifichi una parte esistente, Aggiungi ne crea una nuova e lascia invariata quella modificata.

Le nuove parti vanno nel primo spazio libero della pagina, partendo dal basso a sinistra, a 2 mm l’una dall’altra e a 3 mm dal bordo. Ogni oggetto sulla pagina viene evitato e un assieme (come una scatola) mantiene la sua disposizione. Quando la pagina è piena, la parte va su una nuova pagina. Per una parte più grande dell’area di lavoro viene chiesto prima: **Crea comunque** al centro, tornare indietro o annullare. Ogni Crea o Aggiungi è un solo passo di annullamento.

### Modificare una parte in seguito

I generatori creano **parti parametriche**: conservano i loro parametri nel progetto. **Fai doppio clic** su una parte per riaprire la sua finestra. Il contorno viene ricalcolato, posizione e rotazione restano. Per un assieme come una scatola, un doppio clic su un pannello qualsiasi modifica l’intera scatola; le parti non più necessarie scompaiono e quelle nuove (come un coperchio) vengono aggiunte.

Alcune modifiche romperebbero i parametri: il ridimensionamento, la modifica dei nodi o un’operazione booleana senza “Mantieni originali”. KizamuBeam chiede allora se convertire la parte in percorsi normali o modificarne invece i parametri. **Converti in percorso** fa la conversione di proposito.

### Formule e parametri

Ogni campo numerico accetta un [parametro del progetto](../features/templates-library.md#parameters) o una formula, per esempio `{Spessore}` o `{Larghezza} - 2 * {Spessore}`. I campi di scelta e sì/no ricevono un parametro con il pulsante ƒ. Così una scatola in un modello segue i valori inseriti, e cambiando lo spessore del materiale in un solo punto si aggiornano tutte le parti.

### Kerf e gioco

La maggior parte dei generatori ha un campo **Kerf**: la larghezza del taglio laser. I contorni vengono spostati verso l’esterno della metà, fori e asole diventano più piccoli, così le parti escono alla misura nominale. Un offset kerf sul livello si aggiunge, quindi imposta il kerf in un solo punto.

Le parti a incastro hanno anche un **Gioco di accoppiamento**: quanto gioco riceve ogni giunzione (i valori negativi danno un accoppiamento a pressione). Quando il materiale del livello è [calibrato](../features/materials-tests.md#calibrate-fit), le nuove parti prendono spessore, kerf e gioco dalla calibrazione, e quelle esistenti offrono un pulsante per applicarla.

### Controllare il risultato

La [vista 3D](../features/construction-3d.md#3d-view) mostra gli assiemi montati e segna le collisioni in rosso. Il [controllo del progetto](../features/construction-3d.md#check-the-design-before-cutting) verifica l’accoppiamento di ogni giunzione e se le parti si possono montare in un qualche ordine.
