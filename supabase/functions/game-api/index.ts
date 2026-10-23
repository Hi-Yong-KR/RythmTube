// Rythm Tube 지갑/상점/결제 API
// 클라이언트는 players 테이블에 직접 접근하지 못하고, 이 함수가 플레이어를 확인한 뒤 service role로 처리한다.
// 플레이어 확인: 구글 로그인 토큰(Authorization: Bearer)이 있으면 계정 플레이어, 없으면 게스트 secret.
import { createClient } from "npm:@supabase/supabase-js@2";

// 코인은 토스페이먼츠 결제 승인(confirm_payment)으로만 지급한다
const TOSS_SECRET_KEY = Deno.env.get("TOSS_SECRET_KEY") ?? "test_gsk_docs_OaPz8L5KdmQXkzRz3y47BMw6"; // 토스 문서 공개 테스트 키

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

/** 게스트 플레이어. 계정에 연결된 플레이어는 secret_hash가 비어 있어 여기서 통과하지 못한다 */
async function guestPlayer(playerId: unknown, secret: unknown) {
  if (typeof playerId !== "string" || typeof secret !== "string") return null;
  const { data } = await db.from("players").select("id, secret_hash").eq("id", playerId).maybeSingle();
  if (!data?.secret_hash || data.secret_hash !== (await sha256(secret))) return null;
  return { id: data.id as string };
}

/** 로그인 토큰의 사용자. 토큰이 없으면 null, 있는데 틀리면 "invalid" */
async function tokenUser(req: Request) {
  const h = req.headers.get("Authorization");
  if (!h?.startsWith("Bearer ")) return null;
  const { data, error } = await db.auth.getUser(h.slice(7));
  return error || !data.user ? "invalid" : data.user;
}

/** 계정 플레이어 id. 처음이면 만들거나, 넘겨받은 게스트를 계정으로 올린다/합친다 */
async function accountPlayer(userId: string, guestId: string | null = null) {
  if (!guestId) {
    const { data } = await db.from("players").select("id").eq("user_id", userId).maybeSingle();
    if (data) return data.id as string;
  }
  const { data, error } = await db.rpc("link_player", { p_user: userId, p_guest: guestId });
  if (error) {
    // 첫 로그인 직후 요청 두 개가 동시에 계정 플레이어를 만들려 한 경우: 먼저 만든 쪽을 쓴다
    if (error.code !== "23505") throw error;
    return accountPlayer(userId, guestId);
  }
  return data as string;
}

/** 요청한 플레이어: 로그인했으면 계정, 아니면 게스트 */
async function authPlayer(req: Request, body: Record<string, unknown>) {
  const user = await tokenUser(req);
  if (user === "invalid") return null;
  if (user) return { id: await accountPlayer(user.id), account: true };
  const guest = await guestPlayer(body.playerId, body.secret);
  return guest && { ...guest, account: false };
}

async function wallet(playerId: string) {
  const [{ data: p }, { data: inv }] = await Promise.all([
    db.from("players").select("coins").eq("id", playerId).single(),
    db.from("inventory").select("item_id").eq("player_id", playerId),
  ]);
  const { data: free } = await db.from("shop_items").select("id").eq("price", 0);
  const owned = new Set([...(inv ?? []).map((r) => r.item_id), ...(free ?? []).map((r) => r.id)]);
  return { playerId, coins: p?.coins ?? 0, owned: [...owned] };
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
        const p = await authPlayer(req, body);
        if (!p) return json({ error: "UNAUTHORIZED" }, 401);
        return json(await wallet(p.id));
      }

      // 로그인 직후: 이 브라우저의 게스트(코인·아이템·결제 기록)를 계정으로 옮긴다
      case "link_account": {
        const user = await tokenUser(req);
        if (!user || user === "invalid") return json({ error: "UNAUTHORIZED" }, 401);
        const guest = await guestPlayer(body.playerId, body.secret);
        const id = await accountPlayer(user.id, guest?.id ?? null);
        return json({ ...(await wallet(id)), merged: !!guest });
      }

      case "buy_item": {
        const p = await authPlayer(req, body);
        if (!p) return json({ error: "UNAUTHORIZED" }, 401);
        const { error } = await db.rpc("purchase_item", { p_player: p.id, p_item: body.itemId });
        if (error) {
          const code = ["NOT_ENOUGH_COINS", "ALREADY_OWNED", "ITEM_NOT_FOUND"].find((c) => error.message.includes(c));
          return json({ error: code ?? "PURCHASE_FAILED" }, 400);
        }
        return json(await wallet(p.id));
      }

      case "create_order": {
        const p = await authPlayer(req, body);
        if (!p) return json({ error: "UNAUTHORIZED" }, 401);
        // 산 코인을 잃지 않도록 충전은 로그인한 계정만
        if (!p.account) return json({ error: "LOGIN_REQUIRED" }, 401);
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
        const p = await authPlayer(req, body);
        if (!p) return json({ error: "UNAUTHORIZED" }, 401);
        const { paymentKey, orderId, amount } = body as { paymentKey: string; orderId: string; amount: number };
        if (typeof paymentKey !== "string" || typeof orderId !== "string") return json({ error: "BAD_REQUEST" }, 400);
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
        // 승인 응답이 우리 주문과 같은지 한 번 더 확인
        if (toss.orderId !== orderId || toss.totalAmount !== order.amount || toss.status !== "DONE") {
          console.error("toss confirm mismatch", orderId, toss.status, toss.totalAmount);
          return json({ error: "TOSS_CONFIRM_MISMATCH" }, 400);
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
