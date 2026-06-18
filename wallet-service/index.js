import express from "express";
import { CdpClient } from "@coinbase/cdp-sdk";

const app = express();
app.use(express.json());

const cdp = new CdpClient({
  apiKeyId: process.env.CDP_API_KEY_ID,
  apiKeySecret: process.env.CDP_API_KEY_SECRET,
  walletSecret: process.env.CDP_WALLET_SECRET,
});

const TOKEN = process.env.WALLET_SERVICE_TOKEN;

function authCheck(req, res, next) {
  const auth = req.headers["x-service-token"];
  if (!auth || auth !== TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

app.post("/wallet/create", authCheck, async (req, res) => {
  try {
    const { network, wallet_name } = req.body;

    if (!network || !wallet_name) {
      return res.status(400).json({ error: "network and wallet_name required" });
    }

    let address = "";
    let account_type = "";

    if (network === "solana") {
      const account = await cdp.solana.createAccount({ name: wallet_name });
      address = account.address;
      account_type = "solana";
    } else {
      const account = await cdp.evm.createAccount({ name: wallet_name });
      address = account.address;
      account_type = "evm_eoa";
    }

    return res.status(200).json({ success: true, address, account_type });
  } catch (err) {
    console.error("Wallet create error:", err);
    return res.status(500).json({
      success: false,
      error: err?.message || "Unknown error",
    });
  }
});

app.get("/health", (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Wallet service running on port ${PORT}`));
