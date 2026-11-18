import { h } from '../dom';
import { t } from '../i18n';
import { getTypography, resolveTypography, setTypographyGroup, TYPOGRAPHY_GROUPS, TypographyGroup, TypographyPreset } from '../uiTypography';
import { applyTypography } from '../uiTypographyDom';
import { SettingsField } from './registry';

const fieldId = (group: TypographyGroup) => `appearance.typography.${group}`;

/** The dialog owns the draft; these fields use the feature's existing store only on OK. */
export function typographySettingsFields(): SettingsField[] {
  const labels: Record<TypographyGroup, string> = {
    interface: t('Bedienelemente und Menüs'),
    supporting: t('Hinweise und Zusatztexte'),
    technical: t('Technische Werte und Ausgaben'),
    workspace: t('Beschriftungen im Arbeitsbereich'),
  };
  const group = t('Schriftgrößen');
  return [
    ...TYPOGRAPHY_GROUPS.map((key): SettingsField => ({
      kind: 'slider', id: fieldId(key), label: labels[key], group, def: '100',
      options: () => [80, 100, 125, 150].map((value) => [String(value), `${value} %`]),
      get: () => String(getTypography()[key]),
      set: (value) => setTypographyGroup(key, Number(value) as TypographyPreset),
    })),
    {
      kind: 'custom', id: 'appearance.typography.preview', label: t('Schriftvorschau'), group,
      hint: t('Nur diese Vorschau ändert sich sofort. 100 % setzt eine Schriftgruppe zurück. Mit OK werden die Schriftgrößen übernommen; Dokumente und Exporte bleiben unverändert.'),
      render: (context) => {
        const sample = h('div', { class: 'settings-typography-preview' },
          ...TYPOGRAPHY_GROUPS.map((key) => h('p', {
            'data-typography-group': key,
            // Absolute local baselines: never multiply by the application's inherited font size.
            style: `font-size:calc(${key === 'supporting' ? 11 : 12}px * var(--ty-${key}));overflow-wrap:anywhere`,
          }, labels[key])));
        const refresh = () => applyTypography(sample, resolveTypography(Object.fromEntries(
          TYPOGRAPHY_GROUPS.map((key) => [key, Number(context.read(fieldId(key)))]),
        )));
        refresh();
        context.onChange(refresh);
        return h('div', {}, sample, h('button', {
          id: 'settings-reset-typography', class: 'btn', type: 'button',
          onclick: () => {
            context.update(new Map(TYPOGRAPHY_GROUPS.map((key) => [fieldId(key), '100'])));
            document.getElementById('settings-reset-typography')?.focus();
          },
        }, t('Alle Schriftgruppen zurücksetzen')));
      },
    },
  ];
}
