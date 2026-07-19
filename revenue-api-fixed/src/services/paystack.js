// src/services/paystack.js
// Thin wrapper around the Paystack API. We only need three operations:
//   1. initialize a transaction (returns a hosted-checkout URL)
//   2. verify a transaction by reference (defensive backup if the webhook
//      is delayed or lost by ngrok)
//   3. verify the HMAC-SHA512 signature Paystack sends with each webhook
//
// All amounts cross the wire in the lowest currency subunit. For KES that's
// cents (1 KES = 100 cents). Paystack rejects non-integers.

import crypto from 'crypto'

const PAYSTACK_BASE = 'https://api.paystack.co'

function secret() {
  const k = process.env.PAYSTACK_SECRET_KEY?.trim()
  if (!k) {
    throw Object.assign(new Error('PAYSTACK_SECRET_KEY is not configured'), { statusCode: 500 })
  }
  return k
}

/**
 * Open a Paystack transaction. Returns the hosted-checkout URL plus the
 * reference we generated for it (so the caller can store it on the notice).
 *
 * @param {Object} params
 * @param {string} params.email   Taxpayer email (Paystack requires it; we
 *                                fall back to a no-reply address per notice).
 * @param {number} params.amount  KES amount as a decimal — we convert to
 *                                cents internally.
 * @param {string} params.reference  Stable reference (e.g. NOTICE-7-1718...).
 * @param {string} [params.callbackUrl]  Override; defaults to env.
 * @param {Object} [params.metadata]     Attached to the transaction; surfaced
 *                                       on the webhook so we can route it.
 */
export async function initializeTransaction({ email, amount, reference, callbackUrl, metadata }) {
  const body = {
    email,
    amount: Math.round(Number(amount) * 100), // KES → cents
    currency: 'KES',
    reference,
    callback_url: callbackUrl || process.env.PAYSTACK_CALLBACK_URL,
    metadata: metadata ?? {},
    // Channels we want exposed in the hosted UI — order matters for prominence.
    channels: ['mobile_money', 'card', 'bank', 'bank_transfer'],
  }

  const res = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json?.status) {
    const msg = json?.message || `Paystack initialize failed (${res.status})`
    throw Object.assign(new Error(msg), { statusCode: res.status >= 500 ? 502 : 400 })
  }
  // Shape: { authorization_url, access_code, reference }
  return json.data
}

/**
 * Look up a transaction by its reference. Useful as a backup when the
 * webhook is late — the redirect-callback can poll once to settle the row
 * before the user sees the notice still marked unpaid.
 */
export async function verifyTransaction(reference) {
  const res = await fetch(`${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secret()}` },
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json?.status) {
    const msg = json?.message || `Paystack verify failed (${res.status})`
    throw Object.assign(new Error(msg), { statusCode: res.status >= 500 ? 502 : 400 })
  }
  return json.data
}

/**
 * Webhook signature check. Paystack signs each request body with HMAC-SHA512
 * using the secret key; reject anything that doesn't match.
 *
 * Pass the RAW body string (not the parsed object) — even a re-serialization
 * by JSON.stringify can shift whitespace and break the HMAC.
 */
export function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!signatureHeader) return false
  const expected = crypto
    .createHmac('sha512', secret())
    .update(rawBody, 'utf8')
    .digest('hex')
  // Timing-safe compare to dodge string-comparison side-channels.
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(String(signatureHeader), 'hex'),
    )
  } catch {
    return false
  }
}

/**
 * Paystack returns a `channel` like "mobile_money", "card", "bank_transfer".
 * Map it onto our existing payment_method enum so the ledger still groups
 * cleanly with manual entries.
 */
export function mapChannelToMethod(channel) {
  const c = String(channel ?? '').toLowerCase()
  if (c.startsWith('mobile_money')) return 'mpesa'
  if (c === 'card') return 'bank' // closest fit in current enum
  if (c === 'bank' || c === 'bank_transfer' || c === 'eft') return 'bank'
  return 'bank' // safe default
}
