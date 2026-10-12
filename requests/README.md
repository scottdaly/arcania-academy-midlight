# Core change requests

Each team appends to **its own file** only, so merges never conflict:
`art-fx.md`, `combat.md`, `world.md`, `ui-audio.md`.

Entry format:

```
## <short title>            (status: open | accepted | done | declined)
- What: new tile id / event / game field / input action / state default / bug
- Why: one or two lines
- Proposed shape: signature, payload, or default value
- Workaround in the meantime: ...
```

Core (the lead) reviews these, lands the change in `src/core/`, updates ARCHITECTURE.md and sets the status.
