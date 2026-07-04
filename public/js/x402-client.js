// Minimal browser-side x402 flow:
// request -> 402 (payment requirements in headers) -> wallet signs -> retry with X-PAYMENT.
export async function fetchWithX402(url, options, wallet) {
  const first = await fetch(url, options);
  if (first.status !== 402) return first;

  const headers = {};
  first.headers.forEach((v, k) => (headers[k] = v));
  const body = await first.json().catch(() => null);

  const paymentHeaders = await wallet.createPaymentHeaders({ headers, body });

  return fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), ...paymentHeaders },
  });
}
