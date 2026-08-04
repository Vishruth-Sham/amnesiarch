# Installing Amnesiarch from source

Amnesiarch isn't yet listed in Obsidian's Community Plugins directory (see
[Other install paths](#other-install-paths) below). Until it is, this is how to install it —
by hand, or by having an AI coding agent run these steps for you. Every command below is
copy-pasteable as-is except `<vault>`, which you replace with your vault's actual path.

## Prerequisites

- [Git](https://git-scm.com/)
- [Node.js](https://nodejs.org/) 18 or newer, with npm
- An Obsidian vault

## 1. Clone and build

```bash
git clone https://github.com/Vishruth-Sham/amnesiarch.git
cd amnesiarch
npm install
npm run build
```

This produces `main.js` in the repo root, alongside the `manifest.json` and `styles.css`
that are already checked in. Those three files are everything Obsidian needs to load the
plugin.

## 2. Copy the built files into your vault

Every vault has a `.obsidian/plugins/` folder. Create an `amnesiarch` folder inside it and
copy the three files in:

```bash
mkdir -p "<vault>/.obsidian/plugins/amnesiarch"
cp main.js manifest.json styles.css "<vault>/.obsidian/plugins/amnesiarch/"
```

`<vault>` is the path to your vault's root folder (the one containing `.obsidian/`) — for
example `~/Documents/MyVault`.

## 3. Enable it in Obsidian

Reload Obsidian (command palette → "Reload app without saving", or just quit and reopen),
then go to **Settings → Community plugins**. If this is the first community plugin you've
installed in this vault, you'll be asked to turn off Restricted Mode first. Find
**Amnesiarch** in the installed list and toggle it on.

Amnesiarch is desktop-only — it isn't available on Obsidian's mobile apps.

## Updating

Pull, rebuild, and copy the three files over again:

```bash
cd amnesiarch
git pull
npm run build
cp main.js manifest.json styles.css "<vault>/.obsidian/plugins/amnesiarch/"
```

Then reload Obsidian.

## Alternative: symlink instead of copy (for active development)

If you're iterating on the plugin itself rather than just using it, symlink the whole repo
into the plugins folder instead of copying individual files:

```bash
ln -s "$(pwd)" "<vault>/.obsidian/plugins/amnesiarch"
```

Combined with `npm run dev` (esbuild watch mode, keeps `main.js` current as you edit),
you only need to reload Obsidian to pick up a change — no re-copying.

## Other install paths

- **Community Plugins (Browse)** — the normal way to install an Obsidian plugin, once
  it's listed. Amnesiarch hasn't been submitted to the official directory yet; when it is,
  this page will be updated.
- **[BRAT](https://github.com/TfTHacker/obsidian42-brat)** — installs and auto-updates a
  plugin directly from its GitHub repo, without manual copying, as long as the repo has a
  tagged GitHub Release with `main.js`, `manifest.json`, and `styles.css` attached (this
  repo's [Releases page](https://github.com/Vishruth-Sham/amnesiarch/releases) publishes
  exactly that). Add `Vishruth-Sham/amnesiarch` as a beta plugin in BRAT's settings.
