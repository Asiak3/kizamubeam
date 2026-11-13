---
sidebar_position: 2
title: Targhette con nome da un elenco
description: Creare un modello di targhetta e lavorare un intero elenco di nomi in un solo lavoro, da una tabella o da un file CSV.
---

# Targhette con nome da un elenco

In questo tutorial crei targhette con nome per un gruppo, per esempio una classe o un workshop, partendo da un elenco di nomi. Prepari la targhetta una volta e KizamuBeam dispone una copia per ogni nome.

**Ti serve:** l’elenco dei nomi, in un foglio di calcolo o da digitare, e materiale per le targhette (compensato da 3 mm o acrilico vanno bene).

## 1. Partire dal modello

1. Scegli **File → Nuovo dal modello …** e poi **Targhetta con nome**.
2. La finestra di compilazione mostra i campi del modello: il nome, una **Seconda riga**, la dimensione e se la targhetta ha due fori. Inserisci una dimensione adatta al tuo materiale, per esempio 80 × 30 mm, e conferma.

Il modello è un normale progetto con [parametri](../features/templates-library.md#parameters). Apri **Finestra → Parametri** per vederli: il testo sulla targhetta contiene `{Name}`, che viene sostituito dal valore del parametro.

Puoi anche disegnare la tua targhetta: disegnala, crea un parametro di testo nella finestra Parametri e scrivi `{Name}` in un testo.

## 2. Compilare la tabella

1. Scegli **File → Serie dalla tabella (CSV) …**.
2. Inserisci i nomi, una riga per targhetta. Puoi incollare celle copiate da un foglio di calcolo, oppure caricare un file con **Importa CSV …**.
3. In **Assegna colonne** scegli quale colonna riempie quale parametro. Le colonne il cui titolo corrisponde al nome di un parametro vengono assegnate automaticamente. Lascia la seconda riga su **— mantieni valore —** se ogni targhetta deve mostrare lo stesso testo.

## 3. Disporre la serie

1. In **Layout** scegli **Griglia: tutti quelli che entrano nel piano di lavoro, poi altre pagine**. Imposta la spaziatura tra le targhette, per esempio 3 mm.
2. Fai clic su **Crea serie**.

KizamuBeam aggiunge le targhette su nuove pagine dopo quella corrente, con i nomi inseriti. La pagina del modello resta com’era, e la tabella viene salvata con il progetto: puoi aggiungere nomi in seguito e creare di nuovo la serie.

I nomi lunghi non cambiano la dimensione della targhetta. Controlla le pagine per i nomi troppo larghi, e accorciali o rimpicciolisci il carattere nella pagina del modello prima di creare di nuovo la serie.

## 4. Lavorare le targhette

1. Seleziona una pagina con targhette, controlla i livelli (incisione su **Riempimento**, contorno su **Linea**) e guarda l’anteprima (Alt+P).
2. Posiziona il materiale, esegui il frame e avvia. Poi passa alla pagina successiva.

## Varianti

- **Contatori e date:** per numeri di serie o una data a ogni lavoro invece di un elenco fisso, usa il [testo variabile](../features/text.md).
- **Grezzi in serie:** se incidi grezzi già pronti, taglia una [dima](../features/print-and-cut.md#jigs) e usa **Posiziona nelle asole della dima**: il testo variabile avanza a ogni sede.
- **Il tuo modello:** **File → Salva come modello …** trasforma la tua targhetta in un modello che chiede i suoi valori, con campi e cursori tuoi.
