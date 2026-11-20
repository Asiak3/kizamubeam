# Testfeuer: Sichtbarer Bereich, Dezimalwerte und deutlichere Aus-Bestätigung

> Historischer Übergabestand der UI-Variante, veröffentlicht in `d504f10e`.
> Die unten genannten Windows-/Portable-/Praxistests sind Anwenderberichte für
> diesen früheren Stand, kein Nachweis für spätere Sicherheitskorrekturen.
> Deren native Tests und aktueller Windows-Build sind weiterhin gesondert zu prüfen;
> maßgeblich ist der aktuelle Prüfstatus von PR #440.

**Vorschlag für den PR-Titel:** Testfeuer-Bedienfeld sichtbarer machen und Dezimalwerte akzeptieren

## Was sich für Anwender ändert

- **Lasermodul → Art** ist für Testfeuer keine Voraussetzung mehr. Auch CO₂-, IR-, Faserlaser und Profile ohne Modul-Angabe werden nicht nach Lasertyp gefiltert. Die Firmware-Freigabe bleibt unverändert; insbesondere sind xTool und Ruida weiterhin ausgeschlossen. Bestehende Profile behalten ihre Einstellung **„Testfeuer aktivieren“**. Dadurch können bereits aktivierte Profile mit unterstützter Firmware den Bedienknopf jetzt auch ohne Dioden-Angabe nutzen. Kein Profil wird automatisch aktiviert.
- Im Tab **Verschieben** bleibt der eingerahmte Bereich **Testfeuer** auch bei deaktivierter Funktion sichtbar. Dann sind die Bedienelemente ausgegraut. Ein kurzer Hinweis erklärt die Freigabe pro Gerät. **„Testfeuer-Einstellungen öffnen“** springt für das aktuelle Gerät direkt zum Reiter **Rahmen & Zeiger** und fokussiert **„Testfeuer aktivieren“**, ohne den Haken zu ändern. Der Link funktioniert auch ohne Maschinenverbindung und bleibt gesperrt, solange die bestehende Testfeuer-Sperre aktiv ist.
- Im Tab **Verschieben** und unter **Geräteeinstellungen → Rahmen & Zeiger** akzeptieren Leistung und Dauer sowohl Dezimalkomma als auch Dezimalpunkt, etwa `0,5 %` und `2.5 s`. Ungültige Eingaben sperren weiterhin den Start bzw. das Speichern; es wird nicht auf den letzten gültigen Wert zurückgefallen.
- Im Panel wechselt derselbe Button von **„Testfeuer starten“** zu **„Testfeuer stoppen“**, dann nach Ablauf oder Stopp zur hervorgehobenen **Aus-Bestätigung** und erst nach dieser zurück zu **„Starten“**. Solange noch Start- oder Stoppvorgänge ausstehen, bleibt die Aus-Bestätigung deaktiviert. Ein auf **„Stoppen“** begonnener Klick zählt nicht als Bestätigung, wenn der Timer zwischen Drücken und Loslassen abläuft.
- Unter **Bearbeiten → Einstellungen** in der Gruppe **Laser** ist **„Testfeuer-Overlay auch im Verschieben-Panel anzeigen“** standardmäßig aktiv. Abgewählt blendet die Option das Overlay nur aus, wenn der Bedienknopf im Panel vollständig im sichtbaren Ausschnitt liegt. Bei einem Tabwechsel oder wenn der Knopf aus dem sichtbaren Ausschnitt scrollt, erscheint das Overlay wieder. Die Einstellung gilt nur für diese Installation.
- **„Zum Testfeuer gedrückt halten“** startet eine zeitbegrenzte Sitzung mit Zeiger oder Leertaste. Loslassen, Abbruch, Fokusverlust oder Verlassen des sichtbaren Panels fordert einen Stopp an. Danach ist dieselbe Aus-Bestätigung nötig. Der Button ist kein physischer Totmannschalter.
- **Nicht umgesetzt:** Ein Opt-out für die Aus-Bestätigung. Weder der Ablauf des Software-Timers noch `Idle` beweisen, dass der Laser tatsächlich aus ist. Die Prüfung am Gerät bleibt erforderlich. Das gesamte Testfeuer lässt sich wie bisher über **„Testfeuer aktivieren“** pro Gerät abschalten und ist standardmäßig aus.

## Geänderte Dateien

| Datei | Änderung |
| --- | --- |
| [`src/fire.ts`](../src/fire.ts), [`scripts/fire-test.ts`](../scripts/fire-test.ts) | Entfernen die Modultyp-Prüfung und testen, dass Opt-in, Fernsteuerungssperre und Firmware-Ausschlüsse weiterhin für jedes Profil greifen. |
| [`src/fireUi.ts`](../src/fireUi.ts) | Zeigt den Testfeuer-Bereich dauerhaft, wechselt die Funktion des Bedienknopfs anhand der bestehenden Sitzung, beobachtet dessen Sichtbarkeit und behandelt Gedrückthalten. `readDecimal()` normalisiert Komma und Punkt bei Anzeige, Aktion und Speichern. Start, Stopp und Bestätigung laufen weiterhin über die vorhandene Maschinen- und Sitzungslogik. |
| [`src/laser.ts`](../src/laser.ts) | Öffnet den bestehenden Gerätedialog gezielt im Testfeuer-Abschnitt. Die bestehenden Aufrufe und die Sperre für Geräteänderungen bleiben erhalten. |
| [`src/style.css`](../src/style.css) | Rahmt den Bereich ein, graut abgeschaltete Bedienelemente aus und gestaltet den Einstellungsbutton als Link. `.fire-overlay .fire-confirm:not(:disabled)` hebt nur die freigegebene Aus-Bestätigung hervor. |
| [`src/settings/core.ts`](../src/settings/core.ts), [`src/syncData.ts`](../src/syncData.ts) | Einstellungsfeld für das Overlay; der Speicherschlüssel ist lokal und wird nicht synchronisiert. |
| [`src/locales/`](../src/locales/) | Übersetzungen für neue UI-Texte in Englisch, Spanisch, Italienisch und Brasilianischem Portugiesisch. |
| [`scripts/fire-ui-test.ts`](../scripts/fire-ui-test.ts) | Prüft unter anderem Wechsel von Start über Stopp zur Aus-Bestätigung, Ablauf mitten im Klick, Overlay-Rückfall, Stopp beim Ende des Haltens und Dezimaleingaben. |
| [`scripts/fire-routes-test.mjs`](../scripts/fire-routes-test.mjs) | Prüft die Verdrahtung vom Tab **Verschieben** zum richtigen Einstellungsreiter und Checkbox-Fokus im Quellcode. |
| [`docs/features.de.md`](features.de.md), [`docs/features.md`](features.md) | Dokumentieren die optionale Modul-Angabe und die weiterhin geltenden Firmware-Grenzen. |

Geräteprofile speichern weiterhin dieselben numerischen Felder; es gibt keine Migration und keine neue Abhängigkeit. G-Code-Skalierung und Rundung, Maschinenanbindung, Zeitlimit und Stoppablauf wurden nicht geändert. Eine akzeptierte Dezimalzahl in der UI bedeutet nicht, dass jede Steuerung diese Leistung mit derselben Auflösung ausgeben kann. Die bestehende Sicherheitslogik ist in der [Funktionsdokumentation](features.de.md#laser-und-maschine) beschrieben (Stichwort **Testfeuer**).

## Prüfung und Merge

1. Die Dateien aus der Tabelle auf einem Branch mit aktuellem `main` prüfen. Falls die bestehende Testfeuer-Funktion dort noch nicht enthalten ist, erst deren PR mergen. ZIP, EXE und Build-Ausgaben gehören nicht in den PR.
2. Die folgenden Prüfungen auf dem PR-Stand erneut ausführen. Auf dem lokalen Änderungsstand wurden sie bereits ausgeführt:

   | Befehl | Ergebnis |
   | --- | --- |
   | `npm run test:fire` | 13 Logiktests, 17 UI-Szenarien und 4 Quellcode-Prüfungen bestanden. Die UI-Tests verwenden ein nachgebildetes DOM und eine simulierte Anbindung; sie prüfen nicht die visuelle Darstellung. |
   | `npm run test:sync` | 12 Prüfungen bestanden, einschließlich der Einordnung neuer Speicherschlüssel. |
   | `npm run i18n:check` | Keine fehlenden oder unbenutzten Texte und keine Platzhalterfehler; drei Warnungen zu dynamischen Übersetzungsschlüsseln in `src/view3d/`. |
   | `npm run build` | TypeScript- und Vite-Build erfolgreich. |
   | `npm run tauri build -- --no-bundle --ci --target x86_64-pc-windows-msvc` | Für den aktuellen Stand erfolgreich. Das Portable-ZIP wurde erstellt; die darin enthaltene EXE stimmt laut SHA-256 mit der Build-Ausgabe überein. |

3. **Manueller Praxistest (Anwenderbericht):** Lokal unter Windows mit einem **iKier Pro Max 48 W** getestet. Windows-Version, Controller-Firmware und Ergebnisse einzelner Testfälle wurden nicht angegeben. Der Bericht gilt für diese Gerätekombination; er ist keine allgemeine Hardwarefreigabe. Rahmen, ausgegraute Steuerung und Einstellungslink lassen sich zusätzlich ohne Geräteverbindung visuell prüfen. Für die gezielte Prüfung der Aus-Bestätigung nach Möglichkeit eine simulierte Verbindung verwenden.
4. PR gegen `main` öffnen, KI-Unterstützung bei Implementierung, Tests und Dokumentation offenlegen und gemäß [CONTRIBUTING.md](../CONTRIBUTING.md#squash-merging-and-dependent-pull-requests) per Squash-Merge übernehmen.
