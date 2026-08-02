# Getting started with Amnesiarch

Amnesiarch is an Obsidian plugin. This page covers installing it and taking your first capture.

## Install

In Obsidian, go to **Settings → Community plugins → Browse**, search for **Amnesiarch**, and click
**Install**. Once it's installed, click **Enable**.

Amnesiarch is desktop-only — it isn't available on Obsidian's mobile apps.

## Your first capture

Open the **Quick Capture** pane: click the inbox icon in the left ribbon, or run
**Open Quick Capture** from the command palette (`Cmd/Ctrl+P`).

You'll see a plain text box. Type a fleeting thought exactly the way you'd say it out loud —
you don't need to know which note it belongs in, or word it like a heading. Something like:

> Feature XYZ is also a good idea for project ABC

Then click **Sort this note**.

## Your first Sort

The first time you run Sort in a vault, Amnesiarch needs a moment to download a small AI model it
uses for search (a few dozen megabytes, downloaded once and cached on your machine — see
[How Amnesiarch works](./how-it-works.md#privacy-what-stays-on-your-device) for what this does and
doesn't mean for your privacy). Amnesiarch also indexes your existing notes in the background the
first time it loads in a vault; while that's still running, a small note on the results screen
says so, and results may be incomplete until it finishes.

Once Sort runs, Amnesiarch shows you one of three things, depending on how confident it is:

- a single **confident match** — the note it thinks your thought belongs in, with an "Add"
  action;
- a short list of **a few notes that could match**, for you to pick from; or
- a **new note** screen, if nothing in your vault looks like a good fit yet.

Nothing is written anywhere until you click an action button — Sort only proposes a
destination and shows you a preview first. See [How Amnesiarch works](./how-it-works.md) for what
each of these screens does and how to use them.
