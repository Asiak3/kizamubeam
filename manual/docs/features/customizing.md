---
sidebar_position: 19
title: Customizing and settings
description: Arrange windows and toolbars, change language and theme, and move your settings to another computer or keep them in sync.
---

# Customizing and settings

## Settings window

**Edit → Settings …** holds all application-wide preferences in one window, with a sidebar (General, Appearance, Workspace and snapping, Mouse and keyboard, Machines and services, Extensions and fonts) and a search across all of them. Changes take effect with **OK**; **Cancel** discards them, and **Defaults** resets the current section.

Settings that also have a menu entry (language, theme, snapping, grid and so on) are the same values: changing one place changes the other.

## Language and theme

Under **Edit → Settings → Appearance**, set font sizes separately for controls and menus, supporting text, technical values and output, and workspace labels (80%, 100%, 125% or 150%). Only the sample changes immediately; **OK** applies the sizes and **Cancel** discards them. Choose 100% to reset one group, or use the button below the sample to reset all groups before confirming. Documents and exports are unchanged; native tooltips keep their system font size.

- **View → Language**: English, German or Italian. The default follows the system language.
- **View → Theme** (or the button at the far right of the main toolbar): light or dark. The default follows the system.

## Arranging windows

The tool windows (Cuts / Layers, Objects, Laser, Move, Console, Material, Camera and others) can be arranged freely:

- Drag a tab onto another tab header to put the windows together as tabs.
- Drag it onto the top or bottom edge of a group to place it above or below.
- Drag it onto the left edge, next to the tools toolbar, to dock it on the left.
- Drag it onto the workspace to make it a floating window. ⇥ or a double-click on its header docks it again.

The dividers between windows can be dragged. ▾ or a double-click on a header collapses a group, × on a tab hides the window. The **Window** menu shows and hides all windows and bars.

## Toolbars

Open **Window → Toolbars**, or right-click a toolbar shell, to customize the existing toolbars: add or remove available items, reorder them, insert separators and choose the icon size. The Numeric Edits and Text toolbars also use this layout system; their fields still edit the same feature values.

Drag a toolbar's grip to move it, dock it at any of the four edges or float it inside the app. The edge determines its orientation: horizontal at the top/bottom, vertical at the sides. Floating bars keep their last orientation. Drop near a row boundary to insert a new row between existing rows. Adjust the number of rows or columns inside a bar in the customizer; content that does not fit scrolls internally. Other bars and the workspace settle over 150 ms, unless reduced motion is enabled.

Button groups take one slot. Click the primary button to use the current action; open the group with ▾, a right-click or a **350 ms hold** on the primary button. Drag the open group's grip to detach it. The detached group and its source share the current choice; opening it again raises the existing detached group. Its **×** returns it to the source toolbar. Hiding the source toolbar also hides its detached groups; showing it restores them.

**Lock toolbar layout** prevents layout changes and is saved globally (off by default). A completed drop is saved immediately. **Esc**, loss of window focus or pointer cancellation cancels a move or tear-off without saving it.

- **Reset toolbar layout** restores positions, orientation, rows/columns and visibility and returns detached groups, keeping contents and icon sizes. It does not delete numeric, text or other feature values.
- **Reset all contents** restores built-in contents and group choices, preserving custom bars/groups, positions and icon sizes. **Restore defaults** restores the selected toolbar's contents and its built-in groups' original members. Shared groups update in every toolbar that uses them.

Create, rename or delete your own bars in the customizer; built-in bars cannot be deleted. Indent an action under the preceding action to create a flat button group. Built-in and custom groups support the same member editing: add/remove, indent/outdent and reorder. Feature-control sections are not action groups. Floating toolbars stay inside the app, not in separate OS windows. Workspace profiles and icon/font redesign are not included.

**Window → Reset Windows and Toolbars** brings back the initial layout.

## Mouse and keyboard

Zoom with the mouse wheel and pan with the space bar or the middle mouse button. Panning by dragging with the right mouse button can be switched on under **Edit → Settings → Mouse and keyboard**. See [Keyboard shortcuts](../reference/keyboard-shortcuts.md) for all keys.

## Moving settings to another computer

**File → Transfer Settings …** exports settings, devices, material library, library, templates, extensions and interface layout (each selectable) into one `.kzs` file. Keep it as a backup, or import it on another computer and choose whether to merge or replace. Camera calibrations are only included if you choose them.

## Keeping computers in sync

The desktop app can also sync these settings **through a folder** you choose, such as iCloud Drive, Dropbox, Nextcloud, OneDrive or a network drive. Each computer writes only its own file into the "KizamuBeam" subfolder, so no conflicting copies appear. For each entry, the newest change wins, and deletions are synced too.

## Updates

The desktop app checks for new versions and offers to install them. Under **Edit → Settings → General → Update channel** you choose **Stable** or **Nightly** (nightly builds and release candidates).
