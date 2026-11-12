# Konturversatz: Parameterstudie und Schutzmaßnahmen

Stand08.11.2026. KI-Unterstützung: GPT6.1 Sol (OpenAI) via OpenCode.
Keine Maschine, Anwendung oder Installation gestartet; keine Herstellbarkeitszusage.

## Umfang und tatsächlich ausgeführte Prüfungen

| Reihe | Fälle | Ergebnis |
|---|---:|---|
| Synthetische Basis |60|47 angenommen,10 sicher abgewiesen,3 ganze Versätze zurückgenommen |
| Gezielte synthetische Erweiterungen |52|30 angenommen,22 sicher abgewiesen |
| Originaldatei155–158, ohne154 |114|86 API-angenommen, darunter12 ganze Versätze zurückgenommen;28 abgewiesen |
| Vertiefung neuer Offenwarnungen |3|Reststücke und objektübergreifende Repräsentation getrennt untersucht |

Die114 Originalfälle enthalten54 Basisfälle und60 adaptive Abstandsschritte.
Zurücknehmen eines Versatzes ist kein erfolgreicher Geometrieversuch. Insgesamt
229 Szenarien/Vertiefungen, nicht229 fehlerfreie oder physisch geprüfte Schnitte.
Synthetische Aussagen beziehen sich auf die dortigen Orakel; die Dateistudie
weist zusätzliche Output-Probleme nach. Wiederholung war deterministisch;
Quelldateien bleiben unverändert, kein Projektinhalt im Bericht eingebettet.

Skripte: `scripts/contour-offset-parameter-study.ts`,
`scripts/contour-offset-study-followup.ts`,
`scripts/contour-offset-resource-section-study.ts`,
`scripts/contour-offset-open-result-study.ts`.
Artefakte: `artifacts/contour-offset-study/{results,followup}.json`,
`artifacts/contour-offset-diagnostic/{resource-section-study,open-result-followup}.json`.

## Wesentliche Befunde

1. **Kollapsprüfung allein genügt nicht.** E7:20×1,2-mm-Rechteck,
   Innenversatz0,5995 ergibt0,001mm Ausdehnung /0,018801mm². E18:
   Quadratseite√3, Innenversatz0,865 ergibt0,002mm /0,000004mm². Beides wird
   geometrisch angenommen. Originalkontur42 schrumpft bei0,5 auf1,6723mm²,
   bei0,8 auf0,0626mm², bei0,85 auf0,0050mm²; Kollaps erst ab0,875.
2. **Geometrisch angenommen heißt nicht brauchbare Ausgabesemantik.**15
   Außenversätze an Originalkontur1 erzeugen zusätzliche Offen-/Unverbunden-
   Warnungen. In drei Detailfällen: erhaltener Quellrest mit ca0,0746-mm-Lücke
   plus über Objekte157/158 verteilter Ring. Explizite diagnostische Entfernung
   ungeschützter Reste beseitigt die Offenwarnung, nicht die Unverbunden-Warnung
   oder unterschiedliche Kerf-/Füllwirkung. Keine automatische Restlöschung.
3. **Berechtigte Ablehnungen bleiben nötig.** Übergangsnormale kann den Ring
   verfehlen oder überlappen; verschiedene Quellobjekte können nicht beliebig
   als eine geschlossene Form behandelt werden. Kein Herabsetzen dieser Guards.
4. **Toleranz ist keine Reparatur.**0,04-mm-Lücke wird bei exakt0,04 nicht,
   bei0,041 erkannt (`<`-Vergleich). Toleranzabhängige Anschlüsse kennzeichnen.

## Schutzmaßnahmen im Arbeitsstand

- Neue offene/unverbundene Ausgabe und ungeklärte Kerf-/Füllwirkung werden vor
  der Dokumentänderung geprüft und gesperrt. Vergleich mit ursprünglichen
  Quellen; bestehende Befunde werden nicht allein wegen neuer Unterpfadindizes
  als neue Fehler gezählt.
- Kleine Flächen (bis3mm² als Hinweisheuristik) und sehr kleine Ausdehnungen
  relativ zur Schnittfuge erhalten Warnung und gesonderte Bestätigung. Keine
  allgemeine3mm²-Verbotsregel, keine automatische Löschung.
- Die gemessene kleinste Bounding-Box-Ausdehnung ist **keine** lokale
  Stegdicken-/Bottleneck-Garantie. Material, Fokus, Schnittfuge und thermisches
  Verhalten bleiben zusätzliche Fertigungsbedingungen.
- Abschnittsauswahl zeigt den ganzen Kandidaten vor dem Klick; Mehrdeutigkeit
  und toleranzbedingte Anschlüsse sind explizit. Originale und Undo bleiben.

Endgültige Test-/Buildresultate stehen in `docs/local-builds.md`.
