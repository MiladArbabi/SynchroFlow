import db from '@lasyncro/backend-core/db.js';
import { LifecycleService } from 'api-src/services/lifecycle.service';

describe('Lifecycle snapshot default', () => {
  beforeEach(async () => {
    await db('user_lifecycle_snapshot').truncate();
  });

  it('returns FT_MINUS_ONE when no snapshot exists', async () => {
    const phase = await LifecycleService.resolveForUser(999);

    expect(phase).toBe('FT_MINUS_ONE');
  });
});
