---
sidebar_position: 4
title: Cassetti, inserti e scaffali
description: Cassetti con mobile e frontale, inserti a scomparti per scatole e cassetti e scaffali a incastro senza colla.
---

# Cassetti, inserti e scaffali

Questi generatori si basano sulla scatola con giunzioni a dita e si trovano in **Casella degli strumenti → Scatole e mobili**. Sono tutti assiemi: la [vista 3D](../features/construction-3d.md#3d-view) li mostra montati e i test che li accompagnano verificano che nessuna parte si sovrapponga.

## Cassetto

Un cassetto con un mobile aperto sul davanti, un cassetto abbinato e un pannello frontale. Senza mobile ottieni solo il cassetto, per un’apertura che esiste già.

| Campo | Significato |
|---|---|
| **Larghezza**, **Altezza**, **Profondità** | Misure esterne del mobile. Senza mobile: misure dell’apertura. |
| **Spessore del materiale** | Spessore del pannello. |
| **Con mobile** | Costruisce anche il mobile. |
| **Pannello frontale** | **Sovrapposto (copre il mobile)**, **A incasso (all’interno dell’apertura)** o **Nessuno**. |
| **Maniglia** | **Incavo per la mano** o **Foro rotondo**, con **Larghezza maniglia** (lunghezza dell’incavo o diametro del foro) e **Altezza maniglia**; oppure **Nessuna**. |
| **Gioco laterale**, **Gioco superiore**, **Gioco posteriore** | Spazio tra cassetto e mobile. |
| **Spazio attorno al pannello frontale** | Il frontale diventa più piccolo di questo valore su ogni lato. |
| **Kerf** | Larghezza del taglio laser. |

**Larghezza delle dita** e **Gioco di accoppiamento** si trovano in **Avanzate**.

## Inserto divisorio

Una griglia di divisori a mezzo incastro che si infilano l’uno nell’altro, per una scatola o un cassetto: per viti, perline, bustine di tè o pedine.

| Campo | Significato |
|---|---|
| **Larghezza interna** / **Profondità interna** | Misure interne della scatola o del cassetto in cui va l’inserto. |
| **Altezza dei divisori** | Altezza dei divisori. |
| **Spessore del materiale** | Spessore del pannello. |
| **Scomparti in larghezza** / **Scomparti in profondità** | Numero di scomparti in ogni direzione. |
| **Gioco di accoppiamento** | Le asole diventano più larghe dello spessore del materiale di questo valore; negativo = accoppiamento a pressione. |
| **Gioco alle estremità** | I divisori diventano più corti della misura interna di questo valore, così l’inserto entra facilmente. |
| **Kerf** | Larghezza del taglio laser. |

## Ripiano a incastro

Due fianchi e quanti ripiani vuoi, uniti da incastri a croce: niente colla, niente viti.

| Campo | Significato |
|---|---|
| **Larghezza** | Lunghezza dei ripiani. |
| **Profondità**, **Altezza** | Dimensioni dei fianchi. |
| **Spessore del materiale** | Spessore del pannello. Da 4 mm lo scaffale diventa stabile. |
| **Numero di ripiani** | Da 1 a 30. |
| **Ripiano più basso sopra il pavimento** | Altezza del lato inferiore del ripiano più basso. |
| **Ripiano superiore sotto il bordo superiore** | Distanza dal bordo superiore dei fianchi al lato superiore del ripiano più alto. |
| **Sporgenza del ripiano** | Di quanto i ripiani sporgono oltre i fianchi. |
| **Gioco di accoppiamento** | Larghezza in più delle asole; negativo = accoppiamento a pressione. |
| **Kerf** | Larghezza del taglio laser. |

I ripiani vengono distribuiti in modo uniforme tra il più basso e il più alto.
