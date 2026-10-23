// Rythm Tube 지갑/상점/결제/랭킹 API
// 클라이언트는 players 테이블에 직접 접근하지 못하고, 이 함수가 플레이어를 확인한 뒤 service role로 처리한다.
// 플레이어 확인: 구글 로그인 토큰(Authorization: Bearer)이 있으면 계정 플레이어, 없으면 게스트 secret.
import { createClient } from "npm:@supabase/supabase-js@2";

// 코인은 토스페이먼츠 결제 승인(confirm_payment)으로만 지급한다
const TOSS_SECRET_KEY = Deno.env.get("TOSS_SECRET_KEY") ?? "test_gsk_docs_OaPz8L5KdmQXkzRz3y47BMw6"; // 토스 문서 공개 테스트 키
// 코인 충전을 구글 로그인 계정만 허용할지. 테스트하는 동안은 꺼 두고 게스트도 충전할 수 있게 한다 (Secrets에 on을 넣으면 켜짐)
const CHARGE_REQUIRES_LOGIN = Deno.env.get("CHARGE_REQUIRES_LOGIN") === "on";

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
    db.from("players").select("coins, nickname").eq("id", playerId).single(),
    db.from("inventory").select("item_id").eq("player_id", playerId),
  ]);
  const { data: free } = await db.from("shop_items").select("id").eq("price", 0);
  const owned = new Set([...(inv ?? []).map((r) => r.item_id), ...(free ?? []).map((r) => r.id)]);
  return { playerId, coins: p?.coins ?? 0, owned: [...owned], nickname: (p?.nickname ?? null) as string | null };
}

const DIFFICULTIES = ["NM", "HD", "MX", "SC"];

/** 곡·난이도·키 수 (순위표 하나). 틀리면 null */
function board(body: Record<string, unknown>) {
  const { videoId, difficulty, keys } = body;
  if (typeof videoId !== "string" || videoId.length < 5 || videoId.length > 20) return null;
  if (typeof difficulty !== "string" || !DIFFICULTIES.includes(difficulty)) return null;
  if (!Number.isInteger(keys) || (keys as number) < 1 || (keys as number) > 8) return null;
  return { p_video: videoId, p_difficulty: difficulty, p_keys: keys as number };
}

/** 닉네임 정하기/바꾸기. 다른 플레이어가 쓰는 닉네임이면 NICKNAME_TAKEN */
async function setNickname(playerId: string, raw: unknown) {
  const nickname = typeof raw === "string" ? raw.trim() : "";
  if (nickname.length < 1 || nickname.length > 12) return "BAD_NICKNAME";
  const { error } = await db.from("players").update({ nickname }).eq("id", playerId);
  if (error) {
    if (error.code === "23505") return "NICKNAME_TAKEN";
    throw error;
  }
  return null;
}

async function myRank(playerId: string, b: NonNullable<ReturnType<typeof board>>) {
  const { data, error } = await db.rpc("player_rank", { p_player: playerId, ...b });
  if (error) throw error;
  return (data?.[0] ?? null) as Record<string, unknown> | null;
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
        if (CHARGE_REQUIRES_LOGIN && !p.account) return json({ error: "LOGIN_REQUIRED" }, 401);
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

      case "set_nickname": {
        const p = await authPlayer(req, body);
        if (!p) return json({ error: "UNAUTHORIZED" }, 401);
        const err = await setNickname(p.id, body.nickname);
        if (err) return json({ error: err }, 400);
        return json(await wallet(p.id));
      }

      // 플레이 시작: 기록 등록권을 발급한다. 채보의 판정 수·끝나는 시간을 함께 받아 두고 등록 때 대조한다
      case "start_play": {
        const p = await authPlayer(req, body);
        if (!p) return json({ error: "UNAUTHORIZED" }, 401);
        const b = board(body);
        const { judgeCount, expectedMs } = body as { judgeCount: number; expectedMs: number };
        if (!b || !Number.isInteger(judgeCount) || !Number.isInteger(expectedMs)) return json({ error: "BAD_REQUEST" }, 400);
        // 판정 수는 초당 12개를 넘지 않는다 (가장 어려운 SC 8키도 10개 안팎)
        if (expectedMs < 10000 || expectedMs > 7200000 || judgeCount < 1 || judgeCount > (expectedMs / 1000) * 12) {
          return json({ error: "BAD_REQUEST" }, 400);
        }
        const dayAgo = new Date(Date.now() - 86400000).toISOString();
        await db.from("play_sessions").delete().eq("player_id", p.id).lt("started_at", dayAgo);
        const { count } = await db
          .from("play_sessions")
          .select("id", { count: "exact", head: true })
          .eq("player_id", p.id)
          .gt("started_at", new Date(Date.now() - 60000).toISOString());
        if ((count ?? 0) >= 20) return json({ error: "TOO_MANY_REQUESTS" }, 429);
        const { data, error } = await db
          .from("play_sessions")
          .insert({
            player_id: p.id,
            video_id: b.p_video,
            difficulty: b.p_difficulty,
            key_count: b.p_keys,
            judge_count: judgeCount,
            expected_ms: expectedMs,
          })
          .select("id")
          .single();
        if (error) throw error;
        return json({ sessionId: data.id });
      }

      // 기록 등록: 플레이어마다 곡·난이도·키 수별 최고 기록 하나만 남는다
      case "submit_score": {
        const p = await authPlayer(req, body);
        if (!p) return json({ error: "UNAUTHORIZED" }, 401);
        if (body.nickname !== undefined) {
          const err = await setNickname(p.id, body.nickname);
          if (err) return json({ error: err }, 400);
        }
        const { nickname } = await wallet(p.id);
        if (!nickname) return json({ error: "NICKNAME_REQUIRED" }, 400);
        const r = body as { sessionId: string; score: number; accuracy: number; maxCombo: number; counts: unknown; random: boolean; bpm: number; title: string };
        if (typeof r.sessionId !== "string") return json({ error: "BAD_REQUEST" }, 400);
        const { data, error } = await db.rpc("submit_score", {
          p_player: p.id,
          p_session: r.sessionId,
          p_score: r.score,
          p_accuracy: r.accuracy,
          p_max_combo: r.maxCombo,
          p_counts: r.counts,
          p_is_random: !!r.random,
          p_bpm: Number.isInteger(r.bpm) ? r.bpm : null,
          p_title: typeof r.title === "string" ? r.title : "",
        });
        if (error) {
          const code = ["SESSION_INVALID", "SESSION_EXPIRED", "TOO_EARLY", "BAD_RESULT"].find((c) => error.message.includes(c));
          if (!code) throw error;
          return json({ error: code }, 400);
        }
        const { data: s } = await db.from("play_sessions").select("video_id, difficulty, key_count").eq("id", r.sessionId).single();
        const me = await myRank(p.id, { p_video: s!.video_id, p_difficulty: s!.difficulty, p_keys: s!.key_count });
        return json({ best: data[0].is_best, prevScore: data[0].prev_score, nickname, me });
      }

      // 순위표: 누구나 볼 수 있다. 플레이어가 확인되면 내 순위(me)와 표시(is_me)도 준다
      case "ranking": {
        const b = board(body);
        if (!b) return json({ error: "BAD_REQUEST" }, 400);
        const limit = Number.isInteger(body.limit) ? Math.min(100, Math.max(1, body.limit as number)) : 20;
        const p = await authPlayer(req, body);
        const [{ data: top, error }, me] = await Promise.all([
          db.rpc("song_ranking", { ...b, p_limit: limit, p_player: p?.id ?? null }),
          p ? myRank(p.id, b) : null,
        ]);
        if (error) throw error;
        return json({ top, me });
      }

      default:
        return json({ error: "UNKNOWN_ACTION" }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: "SERVER_ERROR" }, 500);
  }
});
