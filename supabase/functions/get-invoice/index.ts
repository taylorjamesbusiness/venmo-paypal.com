import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const url = new URL(req.url);
  const invoiceId = url.searchParams.get("id");

  if (!invoiceId) {
    return new Response(JSON.stringify({ error: "id required" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/invoices?id=eq.${invoiceId}&select=*`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    }
  );

  const data = await res.json();
  const invoice = data[0];

  if (!invoice) {
    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(invoice), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
