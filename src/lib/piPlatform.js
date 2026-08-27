// src/lib/piPlatform.js
/* eslint-disable no-console */
/**
 * Server-only client for the Pi Platform API.
 * NEVER import this from client-side code (src/components, src/pages) —
 * it reads PI_API_KEY, which must stay a server-only env var (no REACT_APP_ prefix).
 *
 * Docs: https://github.com/pi-apps/pi-platform-docs
 */

const PI_API_BASE = process.env.PI_API_BASE || "https://api.minepi.com/v2";

function apiKey() {
  const key = process.env.PI_API_KEY;
  if (!key) {
    throw new Error(
      "PI_API_KEY is not set. Add it as a server-only env var (Vercel project settings), never with a REACT_APP_ prefix."
    );
  }
  return key;
}

async function piFetch(path, options = {}) {
  const res = await fetch(`${PI_API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${apiKey()}`,
      ...(options.headers || {}),
    },
  });

  const raw = await res.text();
  let body;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    body = { raw };
  }

  if (!res.ok) {
    const message =
      body?.error_message || body?.error || body?.message || `Pi API error (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

/** Fetch the canonical payment record from Pi's servers. Trust this, not client-supplied fields. */
export async function getPayment(paymentId) {
  if (!paymentId) throw new Error("paymentId required");
  return piFetch(`/payments/${encodeURIComponent(paymentId)}`, { method: "GET" });
}

/** Step 1 of the U2A flow: tell Pi's servers you (the app) approve this payment. */
export async function approvePayment(paymentId) {
  if (!paymentId) throw new Error("paymentId required");
  return piFetch(`/payments/${encodeURIComponent(paymentId)}/approve`, { method: "POST" });
}

/** Step 2 of the U2A flow: after the on-chain tx confirms, mark the payment complete. */
export async function completePayment(paymentId, txid) {
  if (!paymentId) throw new Error("paymentId required");
  if (!txid) throw new Error("txid required");
  return piFetch(`/payments/${encodeURIComponent(paymentId)}/complete`, {
    method: "POST",
    body: JSON.stringify({ txid }),
  });
}

/** Cancel a payment app-side (e.g. metadata/amount validation failed). */
export async function cancelPayment(paymentId) {
  if (!paymentId) throw new Error("paymentId required");
  return piFetch(`/payments/${encodeURIComponent(paymentId)}/cancel`, { method: "POST" });
}

/** List payments the app has an incomplete/dangling record for (used to reconcile stuck payments). */
export async function listIncompleteServerPayments() {
  return piFetch(`/payments/incomplete_server_payments`, { method: "GET" });
}
