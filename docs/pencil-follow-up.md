# Bleistift — Rückmeldung und Pointer-Lebenszyklus

Veröffentlicht: [PR #169](https://github.com/negurvulkan/kizamubeam/pull/169),
unabhängig gegen upstream `73e75cb`/2.8.0. Enthält Bleistift samt Optionen,
eigenem Symbol, Standardleisten-Eintrag, Pointerfix und Rückmeldung. Isoliert:
5 Regressionen und 6 Trusted-Mouse-Browserchecks sowie Build/i18n/Apps/History/G-code.

**Benutzerabnahme 07.11.:** „Bleistift funktioniert jetzt so wie erwartet.“
Der ursprünglich gemeldete Ablauf gilt damit für den vom Benutzer getesteten
Build/Eingabeweg als manuell bestätigt. Die folgenden Abschnitte beschreiben
die vorherige Diagnose und automatischen Grenzen; keine allgemeine Plattformfreigabe.

Der gemeldete gewöhnliche Mausablauf „Ziehen, Loslassen, kein Ergebnis“ ließ sich
im aktuellen isolierten Chromium-Editor nicht reproduzieren. Ein echter über CDP
eingespeister Mausstrich erzeugt einen sichtbaren Pfad mit genau einem Undo-Schritt;
normales `lostpointercapture` nach Loslassen entfernt ihn nicht.

Ein konkreter verwandter Fehler wurde reproduziert: `pointerup` eines anderen
Pointers setzte den aktiven Strich vor der Besitzerprüfung auf `null`. Auch
Pointercancel/Capture-Verlust eines fremden Pointers brach ihn ab; ein zweites
Pointerdown konnte ihn ersetzen. Das ist jetzt abgesichert. Pencil-Down verhindert
Browser-Standardaktionen, und Erfolg bzw. ein zu kurzer/ungeeigneter Strich erhält
eine ausdrückliche Rückmeldung. Kein Commit bei Escape, Overflow oder echtem
Pointercancel. Kein automatischer Pfadabschluss oder Abschwächen von Arbeitsgrenzen.

Nachweise: `test:vector` 9 Geometrie + 19 Editorchecks, darunter drei neue
Pointer-/Rückmeldungsregressionen. Chromium mit echten Mausereignissen: 6 Checks
für Übernahme, einen Undo-Schritt, normalen Capture-Verlust, Rückmeldung und
Undo/Redo. `artifacts/local-prototypes/pencil-browser-results.json` enthält das
Ergebnis und die Pointer-Ereignisfolge.

Nicht als endgültiger Nachweis des ursprünglichen Windows-Mausfehlers verstehen:
vor der Benutzerbestätigung blieb native WebView-Abnahme offen. Bei erneutem Auftreten den Status-
Hinweis, Bleistiftoption „Geschlossener Pfad“, Layer-Sichtbarkeit/-Sperre und
Eingabegerät beim Melden mit angeben. Keine App-/Hardware-Inbetriebnahme durch
den Agenten. Kein Bestandteil der vier veröffentlichten Editor-PRs.

Wesentliche KI-Unterstützung: **GPT 6.1 Sol (OpenAI) via OpenCode**.
