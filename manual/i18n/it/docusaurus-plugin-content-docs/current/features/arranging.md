---
sidebar_position: 9
title: Disporre e ripetere
description: Array a griglia e circolari, nesting per risparmiare materiale e riempimenti con motivi senza giunture.
---

# Disporre e ripetere

## Allineare e distribuire

Con più oggetti selezionati, il gruppo di pulsanti di allineamento nella barra principale (e **Disponi → Allinea e distribuisci**) allinea bordi o centri e distribuisce gli oggetti in modo uniforme. Da tastiera: **L R T B** per sinistra, destra, alto, basso, **C** ed **E** per i centri.

## Array

**Strumenti → Array** crea molte copie in una volta, con anteprima dal vivo. Le curve di Bézier vengono copiate esattamente.

- **Array a griglia …** (Ctrl+Maiusc+A): colonne e righe, con lo spazio tra le copie o la distanza tra i loro centri, direzione, uno sfalsamento per ogni seconda riga o colonna (per una disposizione a mattoni) e la specchiatura facoltativa di ogni seconda riga o colonna.
- **Array circolare …**: copie in cerchio intorno a un centro.

## Nesting

**Disponi → Nesting …** (anche nella barra Strumenti e nella Casella degli strumenti) dispone i pezzi selezionati secondo i loro contorni reali, non solo i riquadri di delimitazione, per risparmiare materiale.

**Dove:**

- nell’area di lavoro,
- su una dimensione di materiale (larghezza × altezza in una posizione), oppure
- in una forma selezionata come lastra, per esempio il contorno di un ritaglio.

**Impostazioni:**

- **Distanza** tra i pezzi e dal bordo (considera la larghezza di taglio).
- **Rotazione**: nessuna, solo 180° o a passi di 90°, 45°, 15° o 5°.
- L’angolo da cui iniziare.
- **Precisione**: veloce, normale o accurata. Normale e accurata provano più ordini e tengono il migliore.

I pezzi piccoli possono finire nei fori di quelli grandi, e gli altri oggetti sulla pagina vengono evitati. Ciò che non ci sta va su nuove pagine. Ciò che va insieme si sposta insieme: fori disegnati come forme separate, incisioni e testo su un pezzo, assiemi dei generatori. Il nesting è un passo di annullamento.

## Riempimento con motivo

**Casella degli strumenti → Copia e disponi → Riempi con motivo** riempie una forma chiusa con un motivo senza giunture fatto di vettori reali, per decorare superfici.

1. Seleziona la forma di destinazione.
2. Scegli una tessera: uno dei 13 motivi integrati (nido d’ape, squame, onde, Truchet, anelli, rombi, spina di pesce, intreccio, stelle, punti, griglia di cerchi, chevron, ogiva), un motivo salvato o i tuoi oggetti (un rettangolo intorno a essi definisce la cornice della tessera).
3. Scegli come si ripetono le tessere: griglia, mattoni, mezzo sfalsamento, specchiato, ruotato di 90° (girandola) o esagonale, con sfalsamento, distanza (negativa = sovrapposizione), dimensione, rotazione e spostamento.

Sul bordo il motivo viene tagliato esattamente, oppure restano solo tessere intere; un margine lascia libero il contorno, e testo, immagini e codici sulla forma vengono risparmiati automaticamente. Le linee dove le tessere si incontrano vengono ripulite, così nulla viene lavorato due volte. **Bordi continui** fa proseguire nella tessera vicina le linee che escono dalla tessera.

Il risultato può essere fatto di linee (da incidere, marcare o tagliare) o di aree per livelli di riempimento. Il motivo resta un unico oggetto: un doppio clic modifica qualsiasi impostazione. **Salva come motivo** salva tessera e impostazioni nella libreria.
