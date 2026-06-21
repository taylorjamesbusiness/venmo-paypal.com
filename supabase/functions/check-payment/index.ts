const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// পাবলিক আরপিসি এন্ডপয়েন্ট (মেইননেট)
const SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
const ETHEREUM_RPC_URL = "https://cloudflare-eth.com";

// টোকেন মেটাডেটা (PYUSD)
const PYUSD_SOL_MINT = "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo";
const PYUSD_ETH_CONTRACT = "0x6c3ea9036406852006290770bedfcaba0e23a0e8";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const { invoice_id } = await req.json().catch(() => ({}));

    if (!invoice_id) {
      return new Response(JSON.stringify({ error: "invoice_id required" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // ১. ডাটাবেজ থেকে ইনভয়েস রিড করা
    const dbRes = await fetch(`${SUPABASE_URL}/rest/v1/invoices?id=eq.${invoice_id}&select=*`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    const data = await dbRes.json();
    const invoice = data[0];

    if (!invoice) {
      return new Response(JSON.stringify({ error: "Invoice not found" }), {
        status: 404,
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // অলরেডি পেইড হলে সরাসরি রিটার্ন করা
    if (invoice.status === "paid") {
      return new Response(JSON.stringify({ status: "paid", success: true }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    const walletAddress = invoice.wallet_address;
    const targetAmount = Number(invoice.amount);
    let currentBalance = 0;

    const networkType = invoice.network.toLowerCase();

    // ─── সোলানা নেটওয়ার্কের পেমেন্ট ভেরিফিকেশন লজিক ──────────────────
    if (networkType === "solana") {
      const rpcRes = await fetch(SOLANA_RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getTokenAccountsByOwner",
          params: [
            walletAddress,
            { mint: PYUSD_SOL_MINT },
            { encoding: "jsonParsed" }
          ]
        })
      });

      const rpcData = await rpcRes.json();
      const accounts = rpcData.result?.value || [];

      if (accounts.length > 0) {
        currentBalance = Number(accounts[0].account.data.parsed.info.tokenAmount.uiAmount || 0);
      }
    }
    // ─── ইথারিয়াম নেটওয়ার্কের পেমেন্ট ভেরিফিকেশন লজিক ──────────────
    else if (networkType === "ethereum" || networkType === "evm") {
      // ERC-20 balanceOf(address) এর জন্য স্ট্যান্ডার্ড হেক্স ডাটা
      const cleanAddress = walletAddress.toLowerCase().replace("0x", "");
      const dataParam = "0x70a08231" + cleanAddress.padStart(64, "0");

      const rpcRes = await fetch(ETHEREUM_RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_call",
          params: [
            { to: PYUSD_ETH_CONTRACT, data: dataParam },
            "latest"
          ]
        })
      });

      const rpcData = await rpcRes.json();
      if (rpcData.result && rpcData.result !== "0x") {
        const rawBalance = BigInt(rpcData.result);
        // PYUSD Ethereum এ ৬ ডেসিমেল ব্যবহার করে
        currentBalance = Number(rawBalance) / 1_000_000;
      }
    }

    // ২. পেমেন্ট ভেরিফিকেশন এবং ডাটাবেজ আপডেট
    if (currentBalance >= targetAmount) {
      await fetch(`${SUPABASE_URL}/rest/v1/invoices?id=eq.${invoice_id}`, {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ status: "paid" })
      });

      return new Response(JSON.stringify({ status: "paid", success: true, balance: currentBalance }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ status: "awaiting_payment", success: false, balance: currentBalance }), {
      headers: { ...cors, "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" }
    });
  }
});
