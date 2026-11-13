---
sidebar_position: 6
title: Oggetti, pagine e progetti
description: La finestra Oggetti, nascondere e bloccare, progetti con più pagine, schede dei progetti, cronologia e note.
---

# Oggetti, pagine e progetti

## La finestra Oggetti

La finestra **Oggetti** (a destra sotto i livelli; **Finestra → Oggetti**) mostra tutti gli oggetti della pagina corrente come albero: pagine, livelli, oggetti e gruppi espandibili, con l’oggetto più in primo piano in alto.

- Un clic seleziona un oggetto, Maiusc o Ctrl ne aggiunge altri. La selezione nell’area di lavoro segue.
- Un doppio clic su un nome rinomina un oggetto o un livello.
- **Occhio**: nasconde un oggetto o un livello.
- **Lucchetto**: l’oggetto non si può più selezionare nell’area di lavoro.
- **Icona del laser**: **Non incidere**. L’oggetto resta visibile (disegnato sbiadito, barrato nell’elenco) ma non viene lavorato, non finisce nel G-code e non viene controllato. Utile per pezzi già tagliati o tenuti da parte. Sulla riga di un livello, la stessa icona attiva o disattiva l’uscita dell’intero livello.
- Trascina le righe per cambiare l’ordine di sovrapposizione, spostare oggetti su un altro livello o riordinare i livelli.

Un clic destro apre un menu contestuale con Rinomina, Adatta alla selezione, Nascondi, Sposta sul livello, Sposta sulla pagina e i normali comandi di modifica. Lì gli oggetti nascosti o bloccati si possono mostrare e sbloccare.

### Parcheggiare pezzi fuori dal piano

Con **Coordinate assolute** come modalità di avvio, tutto ciò che si trova completamente fuori dall’area di lavoro viene saltato senza avviso, purché sul piano ci sia altro. Così puoi tenere pezzi di riserva accanto al piano. I pezzi che sporgono solo in parte vengono ancora segnalati.

## Pagine

Un progetto può avere più pagine, per esempio una per materiale o per lastra. Le pagine sono elencate in cima alla finestra Oggetti e nel menu **Pagine**; Pag↑ e Pag↓ passano dall’una all’altra.

- Ogni pagina ha i propri oggetti; le impostazioni dei livelli valgono per tutto il progetto.
- Disegno, lavorazione ed esportazione SVG, DXF o G-code riguardano la pagina corrente. Le esportazioni PDF e AI contengono tutte le pagine.
- Aggiungi, duplica, rinomina (doppio clic), elimina e riordina le pagine trascinandole. Trascina oggetti su una riga di pagina per spostarli lì, oppure usa **Pagine → Sposta la selezione alla pagina successiva**.

Nesting e generatori creano da soli nuove pagine quando i pezzi non ci stanno più.

## Schede dei progetti

Si possono aprire più progetti insieme, come schede sopra l’area di lavoro. Ogni scheda ha pagine, selezione, vista e cronologia di annullamento proprie.

- **File → Nuovo** (Ctrl+N) o **+** apre una scheda vuota. **Apri** e **Nuovo dal modello** usano una nuova scheda, a meno che quella corrente sia vuota.
- Ctrl+Tab e Ctrl+Maiusc+Tab cambiano scheda; trascina per riordinare; × o un clic con il tasto centrale chiude una scheda.
- Le modifiche non salvate sono segnate con •.
- Copia e incolla funziona tra le schede.

Tutte le schede aperte vengono salvate automaticamente e tornano dopo un riavvio.

## Salvare

**File → Salva** (Ctrl+S) salva il progetto come file `.kzb`. Immagini, impostazioni di taglio, pagine, note e parametri sono tutti dentro, quindi il file si può passare ad altri così com’è. I vecchi file `.lwk` si aprono ancora.

## Cronologia

La finestra **Cronologia** (scheda accanto a Oggetti) elenca le ultime 200 modifiche per nome, con l’ora. Un clic su una riga salta di più passi indietro o avanti. I passi annullati restano in grigio sotto lo stato attuale finché una nuova modifica non li scarta.

## Note del progetto

**Finestra → Note** conserva note insieme al progetto, in tre campi:

- **Materiale**: tipo, spessore, dove l’hai comprato.
- **Configurazione**: fuoco, piano, origine, come è fissato il pezzo.
- **Elaborazione**: ordine, passaggi, finitura, cosa cambiare la prossima volta.

Le note vengono salvate nel file del progetto e nei modelli.
