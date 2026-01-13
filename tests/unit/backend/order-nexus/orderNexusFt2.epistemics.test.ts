describe('Orders FT2 — Epistemic Guards', () => {
  it('fact endpoints must not import intelligence or ftep', async () => {
    const module = await import(
      'api-src/services/order-nexus-ft2/orderNexusFt2.timeseries'
    );

    const source = module.toString();

    expect(source).not.toContain('order-intelligence');
    expect(source).not.toContain('order-ftep');
  });
});
