describe('ui-ft2 runtime export', () => {
  it('exports runtime values from root', async () => {
    const mod = await import('@lasyncro/ui-ft2');
    expect(mod).toBeDefined();
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });
});