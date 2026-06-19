const CDP_HOST          = "api.cdp.coinbase.com";
const CDP_API_KEY_ID     = Deno.env.get("CDP_API_KEY_ID")!;
const CDP_API_KEY_SECRET = Deno.env.get("CDP_API_KEY_SECRET")!;
const CDP_WALLET_SECRET  = Deno.env.get("CDP_WALLET_SECRET")!;
const SUPABASE_URL       = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY       = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;


function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
}
function b64urlBytes(b: Uint8Array): string {
  return btoa(String.fromCharCode(...b)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
}
function hexStr(b: Uint8Array): string {
  return Array.from(b).map(x => x.toString(16).padStart(2,"0")).join("");
}


function sortKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sortKeys);
  return Object.keys(obj as Record<string,unknown>).sort()
    .reduce((acc: Record<string,unknown>, k) => {
      acc[k] = sortKeys((obj as Record<string,unknown>)[k]);
      return acc;
    }, {});
}


async function makeApiJwt(method: string, path: string): Promise<string> {
  const raw = Uint8Array.from(atob(
    CDP_API_KEY_SECRET.replace(/-----[A-Z ]+-----/g,"").replace(/\s+/g,"")
  ), c => c.charCodeAt(0));
  const prefix = new Uint8Array([0x30,0x2e,0x02,0x01,0x00,0x30,0x05,0x06,0x03,0x2b,0x65,0x70,0x04,0x22,0x04,0x20]);
  const seed = raw.slice(0, 32);
  const pkcs8 = new Uint8Array(prefix.length + 32);
  pkcs8.set(prefix);
  pkcs8.set(seed, prefix.length);
  const key = await crypto.subtle.importKey("pkcs8", pkcs8, {name:"Ed25519"}, false, ["sign"]);
  const now = Math.floor(Date.now()/1000);
  const header  = b64url({alg:"EdDSA",kid:CDP_API_KEY_ID,typ:"JWT"});
  const payload = b64url({iss:"cdp",nbf:now,exp:now+120,sub:CDP_API_KEY_ID,uri:`${method} ${CDP_HOST}${path}`});
  const sig = new Uint8Array(await crypto.subtle.sign("Ed25519", key, new TextEncoder().encode(`${header}.${payload}`)));
  return `${header}.${payload}.${b64urlBytes(sig)}`;
}


async function makeWalletJwt(method: string, path: string, body: string): Promise<string> {
  const pemContent = CDP_WALLET_SECRET.replace(/-----[A-Z ]+-----/g,"").replace(/\s+/g,"");
  const der = Uint8Array.from(atob(pemContent), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, {name:"ECDSA",namedCurve:"P-256"}, false, ["sign"]);
  const bodyHash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)));
  const reqHash = hexStr(bodyHash);
  const now = Math.floor(Date.now()/1000);
  const jti = crypto.randomUUID();
  const uri = `${method} ${CDP_HOST}${path}`;
  const header  = b64url({alg:"ES256",typ:"JWT"});
  const payload = b64url({iss:"cdp",sub:CDP_API_KEY_ID,nbf:now,exp:now+120,iat:now,jti,uris:[uri],reqHash});
  const sigRaw = new Uint8Array(await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"}, key, new TextEncoder().encode(`${header}.${payload}`)));
  return `${header}.${payload}.${b64urlBytes(sigRaw)}`;
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "content-type,authorization",
      "Access-Control-Allow-Methods": "POST,OPTIONS"
    }});
  }


  try {
    const { amount, network = "ethereum" } = await req.json();
    if (!amount) {
      return new Response(JSON.stringify({error:"amount required"}), {status:400, headers:{"Content-Type":"application/json","Access-Control-Allow-Origin":"*"}});
    }


    // Generate unique IDs for this invoice
    const invoiceId   = crypto.randomUUID();
    const accountName = `inv-${invoiceId.slice(0,8)}`;
    const invoiceCode = `INV-${invoiceId.slice(0,8).toUpperCase()}`;


    // Create CDP EVM wallet
    const evmPath = "/platform/v2/evm/accounts";
    const evmBody = JSON.stringify(sortKeys({name: accountName}));
    const apiJwt    = await makeApiJwt("POST", evmPath);
    const walletJwt = await makeWalletJwt("POST", evmPath, evmBody);


    const cdpRes = await fetch(`https://${CDP_HOST}${evmPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiJwt}`,
        "X-Wallet-Auth": walletJwt
      },
      body: evmBody
    });


    const cdpData = await cdpRes.json();
    console.log("CDP response", cdpRes.status, JSON.stringify(cdpData));


    if (!cdpRes.ok) {
      return new Response(JSON.stringify({error:"CDP wallet creation failed", details:cdpData}), {status:502, headers:{"Content-Type":"application/json","Access-Control-Allow-Origin":"*"}});
    }


    const walletAddress = cdpData.address;


    // Persist invoice to Supabase
    const dbRes = await fetch(`${SUPABASE_URL}/rest/v1/invoices`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Prefer": "return=representation"
      },
      body: JSON.stringify({
        id: invoiceId,
        invoice_code: invoiceCode,
        account_name: accountName,
        network,
        wallet_address: walletAddress,
        wallet_provider: "coinbase_cdp",
        asset: "PYUSD",
        amount_usd: Number(amount),
        amount: Number(amount),
        status: "awaiting_payment",
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        created_at: new Date().toISOString()
      })
    });


    const dbData = await dbRes.json();
    console.log("DB insert", dbRes.status, JSON.stringify(dbData));


    if (!dbRes.ok) {
      return new Response(JSON.stringify({error:"DB insert failed", details:dbData}), {status:502, headers:{"Content-Type":"application/json","Access-Control-Allow-Origin":"*"}});
    }


    return new Response(JSON.stringify({
      success: true,
      invoice_id: invoiceId,
      invoice_code: invoiceCode,
      wallet_address: walletAddress,
      network,
      amount: Number(amount)
    }), {
      status: 200,
      headers: {"Content-Type":"application/json","Access-Control-Allow-Origin":"*"}
    });


  } catch (err) {
    console.error("Unhandled error:", err);
    return new Response(JSON.stringify({error: String(err)}), {status:500, headers:{"Content-Type":"application/json","Access-Control-Allow-Origin":"*"}});
  }
});
