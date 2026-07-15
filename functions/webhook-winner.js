const { getSupabase } = require("./lib/supabase");

const UTMIFY_TOKEN = "lzASZob4ldSJJc3jT1LILy9alPxWJgpnPhCh";

async function sendUtmify(status, transactionId, amount, payer, metadata, paidAt, createdAt) {
  try {
    const amountCents     = Math.round((amount || 0) * 100);
    const gatewayFeeCents = Math.round(amountCents * 0.027);
    const netCents        = amountCents - gatewayFeeCents;
    const now = new Date().toISOString().replace("T"," ").slice(0,19);
    const payload = {
      orderId: transactionId, platform: "WinnerPay", paymentMethod: "pix", status,
      createdAt: (createdAt || now).replace("T"," ").slice(0,19),
      approvedDate: status === "paid" ? (paidAt || now).replace("T"," ").slice(0,19) : null,
      refundedAt: status === "refunded" ? now : null,
      customer: { name:payer?.name||null, email:payer?.email||null, phone:null, document:payer?.document||null, country:"BR", ip:"177.0.0.1" },
      products: [{ id:"loja-shopify-br-001", name:"Loja Shopify BR", planId:null, planName:null, quantity:1, priceInCents:amountCents }],
      trackingParameters: {
        src: null, sck: null,
        utm_source:   metadata?.utm_source   || null,
        utm_campaign: metadata?.utm_campaign || metadata?.campaign_name || null,
        utm_medium:   metadata?.utm_medium   || null,
        utm_content:  metadata?.utm_content  || null,
        utm_term:     metadata?.utm_term     || null,
        fbclid:       metadata?.fbclid       || null,
      },
      commission: { totalPriceInCents:amountCents, gatewayFeeInCents:gatewayFeeCents, userCommissionInCents:netCents, currency:"BRL" },
      isTest: false,
    };
    const resp = await fetch("https://api.utmify.com.br/api-credentials/orders", {
      method:"POST", headers:{"Content-Type":"application/json","x-api-token":UTMIFY_TOKEN}, body:JSON.stringify(payload),
    });
    console.log(`[UTMify winner] ${status} -> ${resp.status}: ${await resp.text()}`);
  } catch (err) { console.error("[UTMify] Erro:", err); }
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type":"application/json", "Access-Control-Allow-Origin":"*" },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return jsonResponse(405, { error: "Method not allowed" });

  let body = {};
  try { body = event.body ? JSON.parse(event.body) : {}; } catch { return jsonResponse(400, { error: "Invalid JSON" }); }

  const eventType     = body.event || event.headers?.["x-winnerpay-event"] || "";
  const transactionId = body.transaction_id || body.external_id || null;
  const status        = (body.status || "").toLowerCase();
  const amount        = body.amount || 0;
  const payer         = body.payer || {};
  const metadata      = body.metadata || {};
  const paidAt        = body.updated_at || null;
  const createdAt     = body.created_at || null;

  console.log(`[WinnerPay Webhook] ${eventType} | ${transactionId} | ${status}`);

  // Mapeia status → UTMify
  const statusMap = {
    pending:    "waiting_payment",
    paid:       "paid",
    completed:  "paid",
    refused:    "cancelled",
    failed:     "cancelled",
    cancelled:  "cancelled",
    refunded:   "refunded",
    chargeback: "chargeback",
  };

  const utmifyStatus = statusMap[status];
  if (utmifyStatus) {
    await sendUtmify(utmifyStatus, transactionId, amount, payer, metadata, paidAt, createdAt);
  }

  // Atualiza Supabase se pago
  if ((status === "paid" || status === "completed") && transactionId) {
    try {
      const supabase = getSupabase();
      await supabase.from("transactions")
        .update({ status: "paid", paid_at: paidAt || new Date().toISOString() })
        .eq("transaction_id", transactionId);
    } catch (_) {}
  }

  return jsonResponse(200, { ok: true });
};
