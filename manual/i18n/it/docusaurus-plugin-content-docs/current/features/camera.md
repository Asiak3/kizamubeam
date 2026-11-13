---
sidebar_position: 14
title: Fotocamera
description: Mostra il piano nell’area di lavoro con una fotocamera USB o di rete, calibrala e posiziona automaticamente i progetti sui pezzi.
---

# Fotocamera

Con una fotocamera sopra il piano vedi il materiale direttamente sotto il progetto e puoi posizionare il progetto esattamente dove deve stare.

## Scegliere una fotocamera

Apri la finestra **Fotocamera** e scegli una fotocamera:

- una **fotocamera USB**, oppure
- una **fotocamera di rete** che fornisce uno stream MJPEG o immagini singole via `http://`, per esempio una ESP32-CAM o la fotocamera virtuale della [Macchina virtuale](virtual-machine.md).

L’immagine viene raddrizzata e posizionata sotto gli oggetti nell’area di lavoro. Puoi impostarne l’opacità e aggiornarla una volta o di continuo. **Inserisci come immagine** mette l’immagine attuale sul livello T1, per esempio per ricalcarla. Su macOS il sistema chiede il permesso per la fotocamera al primo collegamento.

Un dispositivo può avere più fotocamere, ognuna con la propria calibrazione, tutte mostrate contemporaneamente.

## Calibrare

La fotocamera deve imparare dove si trova il piano nella sua immagine:

1. Avvia la calibrazione nella finestra Fotocamera.
2. Fai incidere al laser una griglia di marcatori (da 2 × 2 a 5 × 5) su un ritaglio, oppure salva i marcatori come G-code.
3. Scatta una foto e fai clic su ogni marcatore nella foto.

KizamuBeam calcola la posizione e, da 3 × 3 marcatori, la distorsione dell’obiettivo. Mostra l’errore residuo in mm e una vista di controllo raddrizzata. La finestra di calibrazione ha propri comandi per collegare la macchina, eseguire l’azzeramento e spostarla.

Le calibrazioni si possono esportare come file `.kzb-camera` e importare su un altro computer con la stessa fotocamera e lo stesso supporto.

## Regolare l’immagine

La finestra Fotocamera può spostare, allungare e ruotare leggermente la sovrapposizione senza una nuova calibrazione, e regolare luminosità, contrasto, saturazione e gamma o mostrare l’immagine in grigio. Queste impostazioni cambiano solo la visualizzazione, non la calibrazione.

## Fotocamera sulla testa

Una fotocamera sulla testa laser vede solo una piccola area. KizamuBeam la calibra con piccoli marcatori intorno alla posizione della testa e colloca ogni immagine nella posizione della testa in cui è stata scattata. **Acquisisci piano di lavoro** o **Acquisisci selezione** sposta la testa sull’area (laser spento) e unisce le immagini. Il campo visivo è mostrato tratteggiato nella posizione della testa.

## Posizionare sui pezzi {#place-on-workpieces}

**Posiziona sui pezzi** (nella finestra Fotocamera o in **Casella degli strumenti → Copia e disponi**) trova pezzi uguali nell’immagine della fotocamera e mette il progetto selezionato su ognuno, con posizione e rotazione corrette.

1. Metti i pezzi sul piano e scatta una foto.
2. Seleziona il progetto. Disegna il contorno del pezzo intorno a esso (il contorno può stare ovunque, anche accanto al piano), oppure metti il progetto su uno dei pezzi riconosciuti.
3. Nella finestra fai clic sui pezzi per includerli o escluderli, ruotali di 90° o 180° e controlla l’anteprima arancione tratteggiata nell’area di lavoro.

I pezzi vengono distinti dal piano in base alla luminosità, o in modo più affidabile con una foto memorizzata del piano vuoto. Sensibilità e dimensione minima sono regolabili. Opzioni: posizionare anche il contorno, nascondere poi il modello, raggruppare per pezzo. Un passo di annullamento.

Per serie con una disposizione fissa, una [maschera](print-and-cut.md#jigs) è spesso più precisa.
