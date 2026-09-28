import { devSeedLineItemId } from '../../../../apps/backend/seeds/helpers/devSeedLineItemId';

it('keeps QA provider line identities distinct across shops and stable across reruns and order traversal', () => {
  const orders = ['800001', '800002', '800003'];
  const firstShop = orders.map(order => devSeedLineItemId(1, order));
  const secondShop = orders.map(order => devSeedLineItemId(6, order));

  expect(new Set([...firstShop, ...secondShop]).size).toBe(6);
  expect([...orders].reverse().map(order => devSeedLineItemId(6, order)).reverse())
    .toEqual(secondShop);
  expect(orders.map(order => devSeedLineItemId(1, order))).toEqual(firstShop);
  for (const id of [...firstShop, ...secondShop]) {
    expect(id).toMatch(/^gid:\/\/shopify\/LineItem\/[1-9][0-9]*$/);
  }
});
