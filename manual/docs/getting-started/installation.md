---
sidebar_position: 1
title: Installation
description: Download and install KizamuBeam on macOS, Windows and Linux, and keep it up to date.
---

# Installation

KizamuBeam is free and needs no account or license key. Download the installer for your system from the [releases page](https://github.com/negurvulkan/kizamubeam/releases) or the [website](https://negurvulkan.github.io/kizamubeam/en/#download).

| System | File |
|---|---|
| **macOS** (Apple Silicon and Intel) | `KizamuBeam_…_universal.dmg` |
| **Windows** (64-bit) | `KizamuBeam_…_x64-setup.exe` |
| **Linux** (64-bit) | `KizamuBeam_…_amd64.AppImage`, `.deb` or `.rpm` |

## macOS

1. Open the `.dmg` file and drag **KizamuBeam** into the **Applications** folder.
2. Start KizamuBeam from the Applications folder.

The app is not notarized by Apple yet, so on the first start macOS may say that it cannot be checked. Open **System Settings → Privacy & Security**, scroll down and click **Open Anyway**. You only need to do this once.

:::tip If “Open Anyway” does not appear
Open the Terminal and run

```bash
xattr -cr /Applications/KizamuBeam.app
```

Then start KizamuBeam again.
:::

## Windows

1. Run `KizamuBeam_…_x64-setup.exe`.
2. If Windows SmartScreen warns about an unknown publisher, click **More info → Run anyway**. The installer is not code-signed yet, which is common for young open-source projects.
3. Follow the installer. KizamuBeam then appears in the Start menu.

## Linux

Pick the package that suits your distribution:

- **AppImage** (any distribution): make the file executable and start it.
  ```bash
  chmod +x KizamuBeam_*_amd64.AppImage
  ./KizamuBeam_*_amd64.AppImage
  ```
- **.deb** (Debian, Ubuntu, Linux Mint …):
  ```bash
  sudo apt install ./KizamuBeam_*_amd64.deb
  ```
- **.rpm** (Fedora, openSUSE …, stable releases only):
  ```bash
  sudo dnf install ./KizamuBeam-*.x86_64.rpm
  ```

:::note USB connection on Linux
To talk to a laser over USB, your user usually needs access to serial ports. On most distributions that means membership in the `dialout` group (on Arch-based systems `uucp`). Log out and back in after adding yourself:

```bash
sudo usermod -aG dialout $USER
```
:::

## Updates

KizamuBeam checks for new versions and updates itself: **Help → Check for Updates …**. Under **Edit → Settings → General → Updates** you choose the update channel:

- **Stable**: only finished releases (recommended).
- **Nightly (including pre-releases)**: a new build every night from the current development state, plus release candidates before each stable version. Try new features earlier and help find bugs. Nightly builds are **not tested on real hardware**: watch your first job, and files saved with a nightly build may not open in the stable version.

If you used the former Beta channel, KizamuBeam switches you to Stable; choose Nightly yourself if you want it.

## Next steps

- [The user interface](interface.md): a tour of the main window.
- [Connecting a laser](connect-laser.md): the setup wizard opens by itself on the very first start.
