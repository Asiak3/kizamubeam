---
sidebar_position: 16
title: Modelli, libreria ed estensioni
description: Rendi i progetti regolabili con i parametri, salvali come modelli, produci serie da una tabella, riusa motivi dalla libreria e installa estensioni.
---

# Modelli, libreria ed estensioni

## Parametri {#parameters}

**Finestra → Parametri** contiene valori con nome per tutto il progetto: numeri, testi e valori sì/no. Puoi usarli ovunque:

- In un testo o codice QR, `{Nome}` inserisce il valore. Funzionano anche le formule: `{Larghezza / 2}`, `{round(Lunghezza; 1)}`, `{Nome + " Srl"}`, `{Coperchio ? "con coperchio" : ""}`. Per le parentesi graffe vere scrivi `{{` e `}}`.
- Nella barra delle modifiche numeriche (X, Y, larghezza, altezza, rotazione, raggio degli angoli, dimensione del carattere e altro) puoi scrivere una formula invece di un numero. Un campo collegato mostra la formula in corsivo; un numero semplice rimuove la formula.
- I campi dei generatori (per esempio lo spessore del materiale di una scatola) accettano un parametro o una formula; i campi a scelta e sì/no ne ricevono uno con il pulsante ƒ.

Quando cambia un valore, tutto viene ricalcolato insieme, su tutte le pagine. I numeri possono avere un intervallo e ricevono allora un cursore. Se rinomini un parametro, il nome cambia in tutti i testi e le formule.

**Modifica → Visibile se …** mostra e lavora un oggetto solo finché vale una condizione, come `Coperchio` o `Larghezza > 100`. Questi oggetti hanno una ƒ nella finestra Oggetti.

## Modelli

Un modello è un progetto con parametri che chiede i suoi valori quando lo usi.

- **File → Salva come modello …** salva il progetto corrente come modello (`.kzt`) con titolo, descrizione e anteprima. Decidi quali parametri chiedere, in che ordine, con quale etichetta e se come cursore. I parametri non richiesti mantengono il loro valore.
- **File → Nuovo dal modello …** mostra i tuoi modelli. Scegliendone uno, si apre come nuovo progetto con una finestra di compilazione e anteprima dal vivo. Annulla ti riporta dove eri.
- **File → Compila modello …** chiede di nuovo i valori del progetto corrente.

KizamuBeam include un **portachiavi** (il nome si rimpicciolisce per starci), una **targhetta con nome** (seconda riga e fori facoltativi) e una **scatola con etichetta** (una scatola a giunzioni a dita con un’etichetta sul davanti). I modelli delle estensioni installate compaiono in “Dalle estensioni”.

I file `.kzt` si aggiungono con **Da file …** nella finestra dei modelli o trascinandoli sull’area di lavoro. Per modificare un modello, aprilo con **File → Apri …**, modificalo e salvalo di nuovo come modello. Nell’app desktop i modelli si trovano nella cartella `templates` della cartella delle impostazioni (**Mostra cartella** la apre).

## Serie da una tabella {#series-from-a-table}

**File → Serie dalla tabella (CSV) …** trasforma ogni riga di una tabella in una copia della pagina corrente con i valori inseriti, per esempio targhette con nome per un’intera classe.

1. Prepara il progetto con i parametri (per esempio `{Nome}` in un testo).
2. Apri la finestra e compila la tabella: una colonna per parametro, una riga per copia. Puoi incollare celle da un foglio di calcolo o importare un file CSV.
3. Scegli la disposizione: una griglia a partire dall’origine della macchina (che continua su altre pagine) oppure una pagina per riga.

Le copie vanno su nuove pagine dopo quella corrente, con i segnaposto sostituiti. La pagina modello resta modificabile. La tabella viene salvata con il progetto, così un modello può portare con sé il proprio elenco. Le colonne vengono associate ai parametri per nome o scelte a mano; i numeri possono usare la virgola decimale, e le colonne sì/no accettano 1, sì e x. Un passo di annullamento.

Per contatori e date a ogni lavoro invece di un elenco fisso, vedi [testo variabile](text.md).

## Casella degli strumenti

**Strumenti → Casella degli strumenti …** (anche **Finestra → Casella degli strumenti** e il pulsante a tessere nella barra Strumenti) elenca tutti i generatori e gli strumenti speciali come tessere, in gruppi: Meccanica, Scatole e mobili, Modelli 3D a incastro, Schizzi con relazioni, Giunzioni e piegatura, Copia e disponi, Testo e dati, Immagine, Laser e calibrazione.

- La **ricerca** guarda nomi, descrizioni e parole chiave in inglese e tedesco; Invio avvia il primo risultato.
- **Preferiti**: un clic destro su una tessera la fissa in alto. Sotto i preferiti ci sono i tre strumenti usati per ultimi.
- Gli strumenti nuovi hanno un’etichetta “NUOVO” finché non li usi una volta.
- Se uno strumento richiede una selezione, la barra di stato dice cosa selezionare.

## Libreria

**Finestra → Libreria** conserva motivi, immagini ed elementi grafici da riutilizzare, con anteprime, ricerca e tag.

- **+ Selezione** (o **Modifica → Aggiungi alla libreria …**) salva gli oggetti selezionati con nome, tipo e tag.
- **File …**, o il trascinamento di file SVG, DXF, PDF, AI, immagini o `.kza` sulla finestra, aggiunge direttamente i file.
- Un doppio clic su una voce, o il trascinamento sull’area di lavoro, la inserisce come gruppo. Una voce su un solo livello finisce sul livello corrente.
- Le voci si possono rinominare, ritaggare ed esportare come file `.kza` da condividere.

KizamuBeam include **400 voci integrate** di design proprio, pronte da tagliare o incidere: 200 motivi (animali, piante, cibo, feste, veicoli, attrezzi, simboli, zodiaco, spazio e altro) e 200 elementi grafici (cornici, bordi, angoli, divisori, ornamenti, distintivi, striscioni, motivi). Sono tutti percorsi vettoriali chiusi. Le voci integrate non si possono modificare; inseriscine una e salvala con **+ Selezione** per tenere la tua versione.

La libreria contiene anche i motivi per il [riempimento con motivo](arranging.md).

## Estensioni {#extensions}

**File → Estensioni …** installa pacchetti (file `.kzp`) che aggiungono modelli di dispositivo, modelli, voci della libreria dei materiali ed elementi della libreria senza una nuova versione di KizamuBeam. Un pacchetto contiene solo dati, mai codice, e ogni voce viene controllata prima dell’installazione.

- Il **catalogo** nella stessa finestra elenca i pacchetti ufficiali: installa o aggiorna con un clic. Il catalogo è firmato, e ogni pacchetto viene verificato con il suo checksum.
- **Installa …** o il trascinamento di un file `.kzp` sull’area di lavoro installa un pacchetto da file. La finestra elenca il contenuto e dice se si tratta di un aggiornamento.
- Rimuovendo un pacchetto, le sue voci spariscono di nuovo.

Cosa è disponibile lo trovi nell’[elenco delle estensioni](../extensions/index.md).
