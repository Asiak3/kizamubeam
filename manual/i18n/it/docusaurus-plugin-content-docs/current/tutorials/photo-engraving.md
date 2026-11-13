---
sidebar_position: 3
title: Incidere una foto sul legno
description: Preparare una foto, scegliere una modalità immagine e trovare le impostazioni giuste per inciderla su compensato o un altro legno chiaro.
---

# Incidere una foto sul legno

In questo tutorial incidi un ritratto o la foto di un animale su un pezzo di legno chiaro, come compensato di pioppo, betulla o tiglio. Nell’incisione di foto contano soprattutto due cose: preparare l’immagine e trovare la velocità e la potenza giuste.

**Ti serve:** una foto con un buon contrasto (un volto in luce uniforme funziona meglio), un pezzo di legno chiaro e liscio e un ritaglio dello stesso legno per il test.

## 1. Importare la foto

1. Scegli **File → Importa** (Ctrl+I) e la foto, oppure trascinala sull’area di lavoro.
2. Ridimensionala alla misura che vuoi, per esempio 100 mm di larghezza. Tieni bloccate le proporzioni, così l’immagine non si deforma.
3. Metti l’immagine su un livello a parte facendo clic su un colore della tavolozza.

## 2. Preparare l’immagine

1. **Rimuovi lo sfondo** se il soggetto deve stare da solo: **Strumenti → Immagine → Rimuovi sfondo …**. Fai clic sullo sfondo nell’anteprima, regola la tolleranza e spunta **Ritaglia al soggetto**.
2. **Modifica l’immagine**: **Strumenti → Immagine → Modifica immagine …**. Il legno scurisce in fretta, quindi la maggior parte delle foto ha bisogno di più luminosità e contrasto di quanto ti aspetti. Aumenta il contrasto finché il volto ha zone chiare e scure ben distinte, e aumenta un po’ la nitidezza. Usa il confronto con l’originale e la vista 1:1.
3. Per dare una forma alla foto, disegna un’ellisse o un rettangolo arrotondato sopra di essa, seleziona entrambi e scegli **Strumenti → Immagine → Applica maschera all’immagine**.

## 3. Scegliere una modalità immagine

Un doppio clic sull’immagine apre le impostazioni del livello con la sezione **Immagine**. Lì scegli la **Modalità immagine**:

- **Atkinson** o **Floyd-Steinberg** sono la scelta sicura per le foto sul legno. Atkinson conserva più contrasto, e questo si adatta bene al legno.
- **Scala di grigi** varia la potenza invece di disegnare punti. Funziona bene solo su materiali che scuriscono in modo uniforme, e richiede un test accurato.
- **Carta da giornale** dà un aspetto a punti rotondi, adatto a immagini grandi viste da una certa distanza.

L’area di lavoro mostra il risultato alla risoluzione del laser; ingrandisci per giudicarlo.

Imposta l’**intervallo tra le linee** in base al punto del tuo laser, di solito da 0,08 a 0,1 mm per un laser a diodo (circa 250–300 linee per pollice). Un intervallo più fine del punto rende solo l’immagine più scura e impastata. Imposta un **Overscan**, così i bordi dell’immagine non vengono più scuri.

## 4. Trovare le impostazioni con un test del materiale

1. Scegli **Laser → Test e calibrazione → Test del materiale …**.
2. Prepara una griglia per l’incisione, per esempio la velocità nelle righe e la potenza nelle colonne, con lo stesso intervallo tra le linee della foto.
3. Esegui il test sul ritaglio dello stesso legno.
4. Scegli la cella scura ma non bruciata. **Valuta test del materiale …** può farlo da una foto del test.

Applica i valori al livello dell’immagine, oppure salvali nella libreria dei materiali per la prossima volta. Altro in [Materiali e test](../features/materials-tests.md#material-test).

## 5. Incidere

1. Guarda l’anteprima (Alt+P) e controlla il tempo: una foto richiede molto più tempo di un testo.
2. Metti a fuoco con cura: un punto sfocato dà un’immagine sfocata. Il [test del fuoco](../features/materials-tests.md) ti aiuta.
3. Posiziona il legno, esegui il frame e avvia. Tieni accesa l’aspirazione, perché incidere il legno produce molto fumo.

## Se il risultato non va

| Problema | Prova |
|---|---|
| Troppo scura, i dettagli si perdono | Più luminosità in Modifica immagine, un intervallo tra le linee più grande o meno potenza. |
| Troppo chiara, poco contrasto | Più contrasto, oppure più potenza o meno velocità. |
| Righe o strisce | Controlla che le cinghie siano tese e che l’intervallo tra le linee non sia più fine del punto. L’overscan evita bordi più scuri. |
| Alone marrone attorno all’immagine | Copri il legno con nastro di carta prima di incidere, oppure puliscilo dopo con un panno umido. |

Per materiali scuri che diventano chiari con il laser, come alluminio anodizzato o ardesia verniciata, spunta **Immagine negativa**.
