import { t } from './i18n';

/** Keep the geometry module DOM-independent; translate its diagnostics at the UI boundary. */
export function vectorError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const messages: Record<string, string> = {
    'Tolerance must be between 0.001 and 100 mm.': t('Toleranz muss zwischen 0,001 und 100 mm liegen.'),
    'Too many points; split the path first.': t('Zu viele Punkte; zuerst den Pfad aufteilen.'),
    'Path contains invalid or excessive coordinates.': t('Pfad enthält ungültige oder zu große Koordinaten.'),
    'Fit subdivision limit exceeded; lower the path complexity.': t('Unterteilungsgrenze erreicht; Pfadkomplexität verringern.'),
    'Fit work limit exceeded; split the path first.': t('Arbeitsgrenze erreicht; zuerst den Pfad aufteilen.'),
    'Path sampling limit exceeded.': t('Abtastgrenze des Pfads erreicht.'),
    'Curve sampling limit exceeded.': t('Abtastgrenze der Kurve erreicht.'),
  };
  return messages[message] ?? message;
}
