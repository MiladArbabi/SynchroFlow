# RO-Overview — Architectural Lock

RO-Overview is NOT a domain.

## It Must NEVER:
- Apply FTEP
- Downgrade data
- Fabricate null snapshots
- Infer meaning
- Read from databases
- Mutate FT2 domain truth

## It May ONLY:
- Observe presence of FT2 snapshots
- Compose already-final FT2 outputs (future)
- Remain silent when trust is not eligible

## Critical Rule
If RO-Overview begins to behave like Orders or Products,
you have rebuilt a domain incorrectly at the top of the system.

Rollback immediately.