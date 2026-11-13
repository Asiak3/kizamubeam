---
sidebar_position: 6
title: Objects, pages and projects
description: The Objects window, hiding and locking, multi-page projects, project tabs, history and notes.
---

# Objects, pages and projects

## The Objects window

The **Objects** window (on the right below the layers; **Window → Objects**) shows all objects of the current page as a tree: pages, layers, objects and expandable groups, with the frontmost object on top.

- A click selects an object, Shift or Ctrl adds more. The selection on the workspace follows along.
- Double-click a name to rename an object or a layer.
- **Eye**: hide an object or layer.
- **Lock**: the object can no longer be selected on the workspace.
- **Laser icon**: **Don’t laser**. The object stays visible (drawn faded, struck through in the list) but is not lasered, not written to G-code and not checked. Handy for parts that are already cut or kept for later. On a layer row, the same icon switches the whole layer’s output.
- Drag rows to change the stacking order, move objects to another layer or reorder layers.

A right-click opens a context menu with Rename, Zoom to Selection, Hide, Move to layer, Move to page and the usual editing commands. Hidden or locked objects can be shown and unlocked there.

### Parking parts outside the bed

With **Absolute Coords** as the start mode, anything that lies completely outside the work area is skipped without a warning, as long as something else is on the bed. This lets you keep spare parts next to the bed. Parts that stick out partly are still reported.

## Pages

A project can have several pages, for example one per material or sheet. Pages are listed at the top of the Objects window and in the **Pages** menu; Page Up and Page Down switch between them.

- Each page has its own objects; the layer settings apply to the whole project.
- Drawing, lasering and SVG, DXF or G-code export work on the current page. PDF and AI export contain all pages.
- Add, duplicate, rename (double-click), delete and reorder pages by dragging. Drag objects onto a page row to move them there, or use **Pages → Move Selection to Next Page**.

Nesting and generators create new pages by themselves when parts do not fit.

## Project tabs

Several projects can be open at once, as tabs above the workspace. Each tab has its own pages, selection, view and undo history.

- **File → New** (Ctrl+N) or **+** opens an empty tab. **Open** and **New from template** use a new tab unless the current one is empty.
- Ctrl+Tab and Ctrl+Shift+Tab switch tabs; drag to reorder; × or a middle-click closes a tab.
- Unsaved changes are marked with •.
- Copy and paste works between tabs.

All open tabs are backed up automatically and come back after a restart.

## Saving

**File → Save** (Ctrl+S) stores the project as a `.kzb` file. Images, cut settings, pages, notes and parameters are all inside, so the file can be passed on as it is. Older `.lwk` files still open.

## History

The **History** window (tab next to Objects) lists the last 200 changes by name, with the time. Click a row to jump several steps back or forward. Undone steps stay greyed out below the current state until a new change discards them.

## Project notes

**Window → Notes** keeps notes with the project, in three fields:

- **Material**: type, thickness, where you bought it.
- **Setup**: focus, bed, origin, how the piece is held.
- **Processing**: order, passes, finishing, what to change next time.

The notes are saved in the project file and in templates.
