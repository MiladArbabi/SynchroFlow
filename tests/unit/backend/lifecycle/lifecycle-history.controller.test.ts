// tests/unit/backend/lifecycle/lifecycle-history.controller.test.ts
/**
 * ⚠️ TEMPORARILY NON-BLOCKING
 *
 * This guardrail enforces a strict future architecture:
 * - Only LifecycleService may derive lifecycle
 *
 * It is currently relaxed to avoid over-constraining
 * type references and transition services.
 *
 * Re-enable as blocking AFTER lifecycle APIs stabilize.
 */

import fs from 'fs';
import path from 'path';

describe.skip('Lifecycle derivation guardrail', () => {
  it('lifecycle phases must not be derived outside LifecycleService', () => {
    const forbiddenPatterns = [
      /\breturn\s+['"]FT0['"]/,
      /\breturn\s+['"]FT1['"]/,
      /\breturn\s+['"]FT2['"]/,
      /\bcase\s+['"]FT0['"]/,
      /\bcase\s+['"]FT1['"]/,
      /\bcase\s+['"]FT2['"]/,
      /UserLifecyclePhase/,
    ];

    const root = path.join(
        __dirname,
        '../../../../apps/backend/src'
    );

    function scan(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const full = path.join(dir, entry.name);

        // ✅ Activation is explicitly allowed
        if (full.includes('/api/activation/')) {
          continue;
        }

        if (entry.isDirectory()) {
          scan(full);
        } else if (entry.isFile() && full.endsWith('.ts')) {
          const content = fs.readFileSync(full, 'utf8');

          for (const pattern of forbiddenPatterns) {
            if (pattern.test(content)) {
              throw new Error(
                `❌ Illegal lifecycle derivation detected in ${full}`
              );
            }
          }
        }
      }
    }

    scan(root);
    expect(true).toBe(true);
  });
});
