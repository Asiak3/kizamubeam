# UI typography

[Developer guide](development.md)

The main application's typography preferences scale four semantic groups independently. They change UI text, not document text, geometry, machine coordinates or font families. This guide describes the existing integration in `src/uiTypography.ts`, `src/uiTypographyDom.ts` and `src/settings/typography.ts`.

## Groups and baseline

| Group (`TypographyGroup`) | Intended text | CSS factor |
| --- | --- | --- |
| `interface` | Controls, menus and primary interface labels | `--ty-interface` |
| `supporting` | Hints, secondary text and explanatory preview labels | `--ty-supporting` |
| `technical` | Technical values and output, such as coordinates and console text | `--ty-technical` |
| `workspace` | Workspace annotations, rulers and measurement labels | `--ty-workspace` |

`TypographyPreset` is `80 | 100 | 125 | 150` (percent). At 100%, each element retains its own existing font size: there is no single pixel size shared by all groups. `TYPOGRAPHY_GROUPS` lists the group IDs. `normalizeTypography(raw)` accepts unknown input and falls back to 100 for each missing or invalid group independently; numeric strings are not presets.

`resolveTypography(candidate)` returns a `ResolvedTypography` with normalized `groups` and numeric `factors` (0.8, 1, 1.25 or 1.5). It is pure: it does not mutate the candidate, read storage, touch the DOM or emit events. `baselineTypography()` resolves all four groups at 100%.

## Store and DOM API

- `initTypography()` reads `kizamubeam.uiTypography` (`TYPOGRAPHY_KEY`) without writing it back. `getTypography()` initializes lazily and returns a copy of the current preferences.
- `setTypographyGroup(group, preset)` persists a changed group and notifies subscribers. Invalid values and unchanged values do nothing.
- `resetTypography(group?)` resets one group, or all groups when omitted, to 100%.
- `onTypographyChange(callback)` returns an unsubscribe function; callbacks read the new state with `getTypography()`.
- `applyTypography(root, resolved)` writes only the four CSS factors on the supplied element. It does not save preferences or subscribe.
- `refreshTypographyDom(root?)` applies the current store; `initTypographyDom(root?)` loads it, applies it and subscribes, returning an unsubscribe function. Both default to `document.documentElement`. `src/app.ts` installs the application-lifetime DOM binding.

Malformed or unavailable storage falls back safely to defaults. Unknown stored fields are not applied but are retained when preferences are saved.

## CSS integration

Use an element's local baseline and one semantic factor, for example:

```css
.example-hint {
  font-size: calc(11px * var(--ty-supporting));
}
```

The root interface size in `src/style.css` already uses the interface factor. Multiplying an inherited, already-scaled size again would compound scaling and couple otherwise independent groups. Use an explicit local baseline when assigning a different group. Preserve the element's existing font family and weight. Related control heights, padding or label boxes may need to grow with the text; this is not page zoom or a blanket scale transform.

## Canvas and SVG integration

Canvas does not inherit CSS font scaling. Resolve preferences for the renderer and use `typographySize(resolved, group, baselinePx)` or `groupFactor(resolved, group)`:

```ts
import { getTypography, resolveTypography, typographySize } from './uiTypography';

const resolved = resolveTypography(getTypography());
ctx.font = `${typographySize(resolved, 'workspace', 10)}px system-ui, sans-serif`;
```

Keep existing device-pixel-ratio and world-to-screen conversions separate from the group factor. Scale annotation text and any associated text boxes, not document geometry or camera calibration. DOM-hosted SVG text can use the CSS factors with its local baseline; SVG markup with an explicit font size can instead calculate that size with the same resolver. `src/editor/render.ts` demonstrates workspace Canvas labels; `src/model3d/ribsPanel.ts` demonstrates supporting labels.

### Subscriptions and cleanup

A retained renderer needs to refresh its resolved state and request a redraw when preferences change:

```ts
let resolved = resolveTypography(getTypography());
const unsubscribe = onTypographyChange(() => {
  resolved = resolveTypography(getTypography());
  requestRedraw();
});
// Call unsubscribe() when the owning dialog or panel is disposed.
```

Here `onTypographyChange` is imported from `src/uiTypography.ts`; `requestRedraw` represents the renderer's existing redraw scheduler. The listener does not run immediately, hence the initial resolution. Dialog examples include `src/testphotoDialog.ts` and `src/slotPlacementDialog.ts`, which unsubscribe on close. A scoped `initTypographyDom()` binding likewise needs its returned cleanup function called when its owner is removed.

## Pure settings preview

The settings dialog owns a draft. `typographySettingsFields()` registers four sliders in Appearance and a custom preview. The preview reads draft values through the custom field context, converts them to numbers, resolves the candidate and calls `applyTypography()` on the sample element only. `context.onChange()` refreshes that sample; `context.update()` changes draft values for the reset button. Neither path calls a store setter.

Only **OK** writes through the fields' setters. **Cancel** leaves the live preferences untouched. Choosing 100% resets one group; the typography reset button sets all four draft values to 100%. This local preview is not a global live preview, and `resolveTypography()` itself never commits anything.

## Image export baseline

`Editor.renderImage()` in `src/editor/render.ts` uses `withBaselineTypography(this, () => this.render())` for its offscreen PNG rendering. The helper temporarily replaces the renderer's `typo` with `baselineTypography()` and restores the previous value in `finally`, including when rendering throws. It is a synchronous scope, not an asynchronous rendering wrapper. The surrounding `renderImage()` code restores the editor's view and other temporary rendering state separately.

Keep UI preferences out of exported document text and geometry. The baseline scope keeps annotations in `renderImage()` independent of the person's UI font-size settings; it does not promise pixel-identical images across operating systems or font environments.

## Scope and limitations

Native browser/OS tooltips (for example, the `title` attribute) and native dialogs are not styled by these CSS factors. The preferences are not a complete UI or accessibility framework: they do not automatically supply keyboard navigation, accessible names, focus handling, contrast, responsive layouts or overflow fixes. Those remain properties of each UI component. Enlarged text still needs visual checks for clipped labels and usable controls.

Focused checks: `npm run test:typography` covers the resolver/store, DOM adapter, control CSS contracts and the editor render pipeline with a recording Canvas, including the image-export baseline and state restoration. `npm run test:settings` includes typography settings integration checks. These do not replace visual inspection or pixel comparisons.
