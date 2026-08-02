# Settings

Amnesiarch's settings live under **Settings → Community plugins → Amnesiarch** (click the gear icon next to
Amnesiarch in that list).

## Exclude from indexing

A text box where you can list folder paths, one per line — for example:

```
Templates
Archive/2023
```

Notes inside these folders (and any of their subfolders) are never scanned, embedded, or
suggested as a place to append your captured text. This is useful for folders you don't want
Amnesiarch reasoning about at all — a templates folder, an old archive, anything that would just add
noise to matching.

A path matches if a note's path is exactly that folder, or sits anywhere underneath it — so
excluding `Archive` also excludes `Archive/2023/Old Notes`, for instance. Leading or trailing
slashes don't matter; `Templates`, `Templates/`, and `/Templates` all mean the same thing.

Changes apply going forward: notes you add or edit inside a newly-excluded folder are skipped
from then on, but a note that was already indexed before you excluded its folder stays in the
index until it next changes — or until you run **Amnesiarch: Rebuild index** from the command palette,
which re-scans every note in your vault from scratch and immediately drops anything now covered
by an exclude pattern.
