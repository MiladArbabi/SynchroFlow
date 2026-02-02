import crypto from 'crypto';

const SHOPIFY_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET;
if (!SHOPIFY_SECRET) {
  throw new Error('SHOPIFY_WEBHOOK_SECRET is not set');
}

const WEBHOOK_URL = 'http://localhost:3000/api/v1/shopify/webhooks';

const rawBody = Buffer.from(
  '{"id":123456789,"order_id":"gid://shopify/Order/16567328080242","status":"fulfilled"}',
  'utf8'
);

const hmac = crypto
  .createHmac('sha256', SHOPIFY_SECRET)
  .update(rawBody)
  .digest('base64');

(async () => {
  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Topic': 'fulfillments/create',
      'X-Shopify-Shop-Domain': 'test.myshopify.com',
      'X-Shopify-Hmac-Sha256': hmac,
    },
    body: rawBody,
  });

  console.log('[STATUS]', res.status);
  console.log('[RESPONSE]', await res.text());
})();
