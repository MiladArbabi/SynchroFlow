import fs from 'node:fs';
import path from 'node:path';

describe('B4-S1-01 Fly shutdown contract', () => {
  it('sets a top-level 15-second kill timeout without changing the ratified service or VM values', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'fly.toml'), 'utf8');
    const topLevel = source.split(/^\s*\[/m)[0];

    expect(topLevel).toMatch(/^\s*kill_timeout\s*=\s*15\s*$/m);
    expect(source).toMatch(/^\s*auto_stop_machines\s*=\s*'off'\s*$/m);
    expect(source).toMatch(/^\s*auto_start_machines\s*=\s*true\s*$/m);
    expect(source).toMatch(/^\s*min_machines_running\s*=\s*1\s*$/m);
    expect(source).toMatch(/^\s*processes\s*=\s*\['app'\]\s*$/m);
    expect(source).toMatch(/^\s*memory\s*=\s*'1gb'\s*$/m);
    expect(source).toMatch(/^\s*cpu_kind\s*=\s*'shared'\s*$/m);
    expect(source).toMatch(/^\s*cpus\s*=\s*1\s*$/m);
  });
});
