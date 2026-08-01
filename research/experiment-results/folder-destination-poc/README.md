# Folder-destination parser POC

Run with:

```sh
node research/experiment-results/folder-destination-poc/poc.js
```

`poc.js` is intentionally standalone and dependency-free. It uses a synthetic nested folder tree and 54 labeled examples (20 train, 34 held-out). Each case has an explicit expected resolved path plus per-segment action: `exact`, `fuzzy`, `create`, `ambiguous`, or `collision`.

## Result (run 2026-08-01)

| policy | train complete plan/action accuracy | held-out complete plan/action accuracy | held-out false auto-correction | held-out ambiguity |
| --- | ---: | ---: | ---: | ---: |
| strict | 18/20 (90.0%) | 34/34 (100.0%) | 0 | 2 |
| balanced | 19/20 (95.0%) | 34/34 (100.0%) | 0 | 2 |
| loose | 19/20 (95.0%) | 33/34 (97.1%) | 1 | 1 |

Selection rule (applied only to train): maximize complete plan/action accuracy; break ties by lower false-auto-correction, then choose the least permissive policy. This selects `balanced` over `loose` (same 19/20 train score, less permissive). `balanced` uses edit distance `1/2/2` for normalized inputs of `<=4`, `5–8`, `>=9` characters; similarity floor `.72`; and no automatic correction if the next sibling is within one edit or `.08` similarity. These are synthetic results, deliberately not a claim of real-vault accuracy.

Held-out diagnostic metrics for balanced: parser 33/34 (97.1%), ancestor-resolution actions 34/34 (100%), requested-leaf create/collision actions 23/23 (100%), zero false automatic corrections, and two ambiguity outcomes. The hold-out includes four explicit exact-collision cases; `research` and `natural-language-processing` are collisions because normalized names already exist, while `archive` below the existing `Archive` folder is a new leaf.

## Design finding

The approach is credible as a *suggestion and confirmation* mechanism, not autonomous routing. It does well for spelling errors within a known parent because sibling-only resolution contains the search space. It cannot infer intent reliably from vague wording, abbreviations, or near-synonyms. Always require confirmation for:

- any fuzzy correction (show requested and matched name),
- ambiguous sibling choices,
- a weak/no relational parse,
- all plans that create folders or notes (the product requirement anyway).

### Parser vs resolution

Parser accuracy here means extracting hierarchy and optional explicit title before matching; it is measured independently from match actions. Resolution accuracy means mapping only **ancestor** segments to an existing sibling versus retaining the requested `New folder …` leaf verbatim as a create. They are deliberately separate in `run()`: parser failures get `confirm`; resolver ambiguity gets `ambiguous`.

Product policy tested: do **not** fuzzy-correct the leaf introduced by `New folder X`. That leaf is a creation request, so retain `X` verbatim; fuzzy-match only its ancestors. An exact normalized leaf collision triggers `collision`, never `create` (four held-out collision cases cover this). This materially reduces accidental substitution (for example, a requested `meeting` folder becoming `Meetings`).

Known limitations: the parser accepts a constrained English grammar; it does not interpret arbitrary natural language, plural intent, or semantic aliases (`NLP` versus `Natural Language Processing`). It treats unknown leaf names as creates, which is safe but may create a duplicate without user review. Unsafe strings are rejected before parsing. Real-world vault aliases should be measured with opt-in, anonymized telemetry or a hand-labeled vault sample before relaxing thresholds.
