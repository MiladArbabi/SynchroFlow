/**
 * WARNING:
 * This lifecycle is protected by invariant tests.
 * Do not modify behavior without updating tests.
 */

Cold boot → FT_MINUS_ONE
User connects → FT0 → FT1
Refresh → FT1 (direct)
Deletion → FT_MINUS_ONE