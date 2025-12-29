export type SpecterFt1Scenario =
  | 'LOADING'            // sessionCount unknown
  | 'NO_SESSIONS'        // zero sessions
  | 'LOW_SIGNAL'         // sessions exist, but confidence not ready
  | 'HEALTHY';           // minimum viable signal exists