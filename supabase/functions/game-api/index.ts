// Rythm Tube 지갑/상점/결제 API
// 클라이언트는 players 테이블에 직접 접근하지 못하고, 이 함수가 플레이어 secret을 검증한 뒤 service role로 처리한다.
import { createClient } from "npm:@supabase/supabase-js@2";

const TOSS_SECRET_KEY = Deno.env.get("TOSS_SECRET_KEY") ?? "test_gsk_docs_OaPz8L5KdmQXkzRz3y47BMw6"; // 토스 문서 공개 테스트 키
// "test"(기본): 결제 없이 코인 지급 / "toss": 토스페이먼츠 결제 승인 후 지급
const PAYMENT_MODE = Deno.env.get("PAYMENT_MODE") ?? "test";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function authPlayer(playerId: unknown, secret: unknown) {
  if (typeof playerId !== "string" || typeof secret !== "string") return null;
  const { data } = await db.from("players").select("id, secret_hash, coins").eq("id", playerId).maybeSingle();
  if (!data || data.secret_hash !== (await sha256(secret))) return null;
  return data;
}

async function wallet(playerId: string) {
  const [{ data: p }, { data: inv }] = await Promise.all([
    db.from("players").select("coins").eq("id", playerId).single(),
    db.from("inventory").select("item_id").eq("player_id", playerId),
  ]);
  const { data: free } = await db.from("shop_items").select("id").eq("price", 0);
  const owned = new Set([...(inv ?? []).map((r) => r.item_id), ...(free ?? []).map((r) => r.id)]);
  return { coins: p?.coins ?? 0, owned: [...owned] };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "BAD_JSON" }, 400);
  }

  try {
    switch (body.action) {
      case "register": {
        const secret = crypto.randomUUID() + crypto.randomUUID();
        const { data, error } = await db.from("players").insert({ secret_hash: await sha256(secret) }).select("id").single();
        if (error) throw error;
        return json({ playerId: data.id, secret, ...(await wallet(data.id)) });
      }

      case "wallet": {
        const p = await authPlayer(body.playerId, body.secret);
        if (!p) return json({ error: "UNAUTHORIZED" }, 401);
        return json(await wallet(p.id));
      }

      case "buy_item": {
        const p = await authPlayer(body.playerId, body.secret);
        if (!p) return json({ error: "UNAUTHORIZED" }, 401);
        const { error } = await db.rpc("purchase_item", { p_player: p.id, p_item: body.itemId });
        if (error) {
          const code = ["NOT_ENOUGH_COINS", "ALREADY_OWNED", "ITEM_NOT_FOUND"].find((c) => error.message.includes(c));
          return json({ error: code ?? "PURCHASE_FAILED" }, 400);
        }
        return json(await wallet(p.id));
      }

      case "test_charge": {
        if (PAYMENT_MODE !== "test") return json({ error: "TEST_CHARGE_DISABLED" }, 403);
        const p = await authPlayer(body.playerId, body.secret);
        if (!p) return json({ error: "UNAUTHORIZED" }, 401);
        const { error } = await db.rpc("test_charge", { p_player: p.id, p_package: body.packageId });
        if (error) return json({ error: error.message.includes("PACKAGE_NOT_FOUND") ? "PACKAGE_NOT_FOUND" : "CHARGE_FAILED" }, 400);
        const { data: pkg } = await db.from("coin_packages").select("coins").eq("id", body.packageId).single();
        return json({ coinsAdded: pkg?.coins ?? 0, ...(await wallet(p.id)) });
      }

      case "create_order": {
        const p = await authPlayer(body.playerId, body.secret);
        if (!p) return json({ error: "UNAUTHORIZED" }, 401);
        const { data: pkg } = await db.from("coin_packages").select("*").eq("id", body.packageId).maybeSingle();
        if (!pkg) return json({ error: "PACKAGE_NOT_FOUND" }, 400);
        const orderId = `rt_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
        const { error } = await db.from("payments").insert({
          order_id: orderId,
          player_id: p.id,
          package_id: pkg.id,
          amount: pkg.price_krw,
          coins: pkg.coins,
        });
        if (error) throw error;
        return json({ orderId, amount: pkg.price_krw, orderName: `Rythm Tube 코인 ${pkg.coins.toLocaleString()}개` });
      }

      case "confirm_payment": {
        const p = await authPlayer(body.playerId, body.secret);
        if (!p) return json({ error: "UNAUTHORIZED" }, 401);
        const { paymentKey, orderId, amount } = body as { paymentKey: string; orderId: string; amount: number };
        const { data: order } = await db.from("payments").select("*").eq("order_id", orderId).maybeSingle();
        if (!order || order.player_id !== p.id) return json({ error: "ORDER_NOT_FOUND" }, 400);
        if (order.status === "done") return json({ alreadyDone: true, ...(await wallet(p.id)) });
        // 결제 금액 위변조 방지: 서버에 저장한 금액과 비교
        if (Number(amount) !== order.amount) return json({ error: "AMOUNT_MISMATCH" }, 400);

        const res = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
          method: "POST",
          headers: {
            Authorization: "Basic " + btoa(TOSS_SECRET_KEY + ":"),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ paymentKey, orderId, amount: order.amount }),
        });
        const toss = await res.json();
        if (!res.ok) {
          await db.from("payments").update({ status: "failed" }).eq("order_id", orderId);
          return json({ error: toss.code ?? "TOSS_CONFIRM_FAILED", message: toss.message }, 400);
        }
        const { error } = await db.rpc("complete_payment", { p_order: orderId, p_payment_key: paymentKey });
        if (error && !error.message.includes("ORDER_NOT_PENDING")) throw error;
        return json({ coinsAdded: order.coins, ...(await wallet(p.id)) });
      }

      default:
        return json({ error: "UNKNOWN_ACTION" }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: "SERVER_ERROR" }, 500);
  }
});
