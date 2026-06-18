Project overview
Project name: Pay Rose PYUSD & BTC Gateway

Goal: Customer PayPal/Venmo থেকে PYUSD এবং on-chain BTC দিয়ে pay করবে, তুমি প্রতিটা customer-এর জন্য আলাদা invoice + wallet address পাবে।

Stack:

Frontend: Static HTML/JS (GitHub Pages)

Backend: Supabase Edge Functions (no Railway)

Wallet infra: CDP Server Wallets for PYUSD (EVM+Solana), BTCPay for BTC

Database: Supabase Postgres (invoices, wallet_accounts, payment_events, provider_settings)

Assets & Networks
Supported assets:

PYUSD

Networks: ethereum, arbitrum, solana (chain_family = evm / solana)

Provider: coinbase_cdp (CDP Server Wallets)

BTC

Network: bitcoin

Provider: btcpay (BTCPay Server Greenfield API)

Database mapping (invoices):

asset: "PYUSD" / "BTC"

network: "ethereum" | "arbitrum" | "solana" | "bitcoin"

amount_usd: customer যে USD পরিমাণ pay করবে

amount_token: token amount (PYUSD-এর জন্য same as amount_usd, BTC-এর জন্য later conversion লাগতে পারে)

status: new, awaiting_payment, paid, underpaid, overpaid, expired, swept, failed

deposit_address: per-invoice address

wallet_provider: "coinbase_cdp" / "btcpay"

wallet_name: CDP/BTCPay side label

expected_chain_id: e.g. 1, 42161, solana-mainnet, bitcoin-mainnet

Core flows (high-level)
1) Invoice creation (Edge Function: create-invoice)
Input (from frontend):

asset: "PYUSD" or "BTC"

network: "ethereum" | "arbitrum" | "solana" | "bitcoin"

amount_usd: number

customer_ref: optional (order id / email)

note: optional

Process:

Validate input (asset/network/amount).

Generate invoice_code → INV-YYYY-XXXX.

PYUSD branch:

Read provider_settings → network_metadata

Call CDP SDK:

cdp.evm.createAccount({ name: wallet_name }) for ethereum/arbitrum

cdp.solana.createAccount({ name: wallet_name }) for solana

Get deposit_address, account_type.

BTC branch:

Call BTCPay Greenfield API POST /api/v1/stores/{storeId}/invoices

Get BTC deposit address + BTCPay invoice id + expiry.

Insert invoices row with status='awaiting_payment'.

Insert wallet_accounts row linked by invoice_id.

Return JSON for frontend: invoice_code, asset, network, deposit_address, amount_usd, amount_token, expires_at, status.

Output (to frontend):

json
{
  "invoice": {
    "invoice_code": "INV-2026-1234",
    "asset": "PYUSD",
    "network": "ethereum",
    "amount_usd": 50,
    "amount_token": 50,
    "deposit_address": "0x....",
    "status": "awaiting_payment",
    "expires_at": "2026-06-19T03:30:00Z",
    "wallet_provider": "coinbase_cdp"
  }
}
2) Frontend pages
index.html (Home / Create invoice)
UI sections:

Hero: title + description

Selector: PayPal / Venmo card (just label)

Asset selector: PYUSD / BTC

Network selector (depends on asset):

PYUSD → ethereum / arbitrum / solana

BTC → bitcoin

Amount input + quick chips

Customer reference input

“Create Invoice” button

Behaviour:

POST to Supabase Edge Function /functions/v1/create-invoice

Success হলে → redirect invoice.html?code=INVOICE_CODE

invoice.html (Invoice view)
URL param থেকে invoice_code নেয়।

Supabase থেকে invoices (আর চাইলে wallet_accounts) fetch করে:

asset, network, deposit_address, amount_usd, amount_token, status, expires_at

UI:

Big amount (USD + token),

Asset + network badge,

Address (copy button),

QR code (optional later),

15 min timer,

Status (awaiting / paid / expired),

“How to Pay” modal:

PYUSD: open PayPal/Venmo app → Crypto → PYUSD buy (if 0) → Send → paste address → pick correct network → send.

BTC: open wallet / BTCPay screen → send to given address.

Polling:

Edge Function /invoice-status (future) বা সরাসরি Supabase query দিয়ে প্রতি X সেকেন্ডে status refresh (= paid/expired etc.).

3) Payment detection (later phase)
আপনি পরে যেটা add করবেন:

New Edge Function(s):

sync-pyusd-payments:

CDP API দিয়ে onchain transfers scan করে matching deposit_address খুঁজে payment_events ও invoices.status update.

sync-btc-payments:

BTCPay webhook বা polling দিয়ে BTC invoice status এনে payment_events + invoices.status update.

4) Admin / Reporting (later)
/admin frontend (একটা আলাদা HTML বা React):

invoices table থেকে filter/search

Total paid, pending, expired

Per-asset totals (PYUSD vs BTC)

Optional Edge Function: admin-summary

aggregated stats ফেরত দেয় (sum, count, per-network, ইত্যাদি)।

৫) Environment & Secrets summary
Supabase project-level secrets:

SUPABASE_URL

SUPABASE_ANON_KEY

CDP_API_KEY_ID

CDP_API_KEY_SECRET

CDP_WALLET_SECRET

BTCPAY_URL

BTCPAY_API_KEY

BTCPAY_STORE_ID

CDP usage: CDP Wallets pay-as-you-go ($0.005 per operation, প্রথম ৫,০০০/month free), তাই প্রতি invoice-এ একবার account create করলে সেই অনুযায়ী cost হবে।
