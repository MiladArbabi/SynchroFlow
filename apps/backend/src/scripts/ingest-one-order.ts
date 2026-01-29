import OrderNexusCanonicalIngestionService from
  'api-src/services/order-nexus-canonical-ingestion.service';

(async () => {
  const svc = new OrderNexusCanonicalIngestionService();
  await svc.enqueueOrderForOrderNexus(2, 'gid://shopify/Order/16610575319410');
  console.log('done');
})();
