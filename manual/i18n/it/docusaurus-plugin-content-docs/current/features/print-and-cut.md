---
sidebar_position: 15
title: Stampa e taglia e maschere
description: Ritaglia con precisione fogli stampati usando marcatori di registro e lavora serie di pezzi con una maschera.
---

# Stampa e taglia e maschere

## Stampa e taglia

Stampa e taglia ritaglia un foglio stampato esattamente lungo la stampa, per esempio adesivi o figure di cartone. Avvialo da **Casella degli strumenti → Laser e calibrazione → Stampa e taglia**.

1. **Posiziona marcatori**: metti tre marcatori di registro intorno al progetto (o trasforma oggetti tuoi in marcatori). I marcatori vengono stampati ed esportati, ma mai lavorati.
2. **Stampa** il progetto a grandezza reale (100 %, senza “adatta alla pagina”).
3. **Misura**: metti il foglio nel laser. Per ogni marcatore porta la testa al suo centro con un punto laser a bassa potenza e i pulsanti di movimento, oppure fai clic su di esso nell’immagine della fotocamera.
4. **Allinea**: KizamuBeam sposta e ruota l’intero progetto sulla stampa. Con tre marcatori corregge anche la scala e l’inclinazione della stampante. Viene mostrato l’errore residuo.
5. Esegui il frame e avvia come al solito.

Due marcatori bastano per spostare e ruotare; tre correggono anche la distorsione della stampante.

## Maschere {#jigs}

Una maschera (jig) è una piastra di supporto con sedi per una serie di pezzi uguali, come grezzi per portachiavi o sottobicchieri. Creala in **Casella degli strumenti → Copia e disponi → Maschera**.

La forma delle sedi può venire da:

- oggetti selezionati (qualsiasi file vettoriale importato, forme o testo),
- una foto o una scansione ricalcata (inserisci la larghezza reale),
- pezzi riconosciuti sul piano con la fotocamera calibrata.

Una maschera può contenere più tipi di pezzi, ognuno con quantità e rotazione di 0° o 90°. Il generatore imposta il gioco per lato (kerf incluso), la distanza tra le sedi, gli incavi per estrarre i pezzi, i numeri delle sedi incisi e tre marcatori di registro incisi. La piastra si adatta alle sedi o ha una dimensione fissa. Un doppio clic sulla maschera in seguito permette di cambiare tutto.

### Usare una maschera

1. Taglia la maschera e lasciala nel laser (o rimettila dentro più tardi).
2. Metti il progetto sulla sede 1, per esempio un nome.
3. Scegli **Casella degli strumenti → Copia e disponi → Posiziona nelle asole della dima** e indica le sedi, come `1-5, 8`. In ogni sede scelta va una copia, nella stessa posizione all’interno della sede.
4. Il testo variabile avanza per ogni sede (numero di serie o riga della tabella), e la maschera stessa viene nascosta, così viene tagliato solo il progetto.

Se togli la maschera e la rimetti, misura i suoi marcatori incisi con Stampa e taglia: maschera e copie vengono allineate insieme.

Per pezzi disposti in qualsiasi punto del piano, vedi [Posizionare sui pezzi](camera.md#place-on-workpieces).
