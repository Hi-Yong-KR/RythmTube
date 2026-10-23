// Rythm Tube 음악 추천 챗봇 "피카 DJ"
// Claude가 답장(reply)과 함께 유튜브 검색어(search) 또는 화면 목록에서 고를 곡 id(select)를 JSON으로 돌려준다.
// 실제 유튜브 검색은 클라이언트가 VITE_YOUTUBE_API_KEY로 수행한다.
import Anthropic from "npm:@anthropic-ai/sdk";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

const SYSTEM = `당신은 웹 리듬게임 "Rythm Tube"의 음악 추천 챗봇 "피카 DJ"예요.
사용자는 유튜브에 올라온 곡을 골라 5키(F V SPACE N J) 리듬게임으로 플레이해요.

할 일
- 기분, 장르, 상황, 좋아하는 가수를 듣고 실제로 존재하는 곡을 추천해요.
- 곡을 화면에 띄워야 하면 search에 유튜브 검색어 하나를 넣어요. "가수 곡명 official MV"처럼 구체적으로 써요.
- 사용자가 화면 목록의 곡을 고르거나 플레이하겠다고 하면 select에 그 곡의 id를 넣어요. 목록에 없는 id는 절대 넣지 않아요.
- 해당 없으면 search와 select는 빈 문자열로 둬요.
- 리듬게임 관점의 짧은 팁(빠른 곡은 노트가 많아 어렵다 등)을 곁들여도 좋아요.

reply는 한국어 해요체로 2~4문장. 추천할 땐 곡명과 가수를 구체적으로 말해요. 음악과 무관한 요청은 정중히 음악 이야기로 돌려요.`;

const SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string", description: "사용자에게 보여줄 답장" },
    search: { type: "string", description: "유튜브 검색어. 없으면 빈 문자열" },
    select: { type: "string", description: "화면 목록에서 고른 곡의 id. 없으면 빈 문자열" },
  },
  required: ["reply", "search", "select"],
  additionalProperties: false,
};

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

interface ShownSong {
  videoId: string;
  title: string;
  channel: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    // 이름을 잘못 넣은 경우를 찾기 쉽게, 비슷한 이름의 시크릿이 있으면 이름만 알려 준다 (값은 절대 노출하지 않음)
    const similar = Object.keys(Deno.env.toObject()).filter((k) => /anthropic|claude|api_?key/i.test(k) && !k.startsWith("SUPABASE"));
    return json({ error: "NO_API_KEY", similar, reply: "챗봇 API 키가 아직 설정되지 않았어요. 관리자에게 ANTHROPIC_API_KEY 설정을 요청해 주세요." }, 503);
  }

  let history: ChatTurn[];
  let shown: ShownSong[];
  try {
    const body = await req.json();
    // 남용 방지: 최근 12개 메시지, 메시지당 600자, 목록 24곡까지만
    history = (Array.isArray(body.messages) ? body.messages : [])
      .filter((m: ChatTurn) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-12)
      .map((m: ChatTurn) => ({ role: m.role, content: m.content.slice(0, 600) }));
    shown = (Array.isArray(body.shown) ? body.shown : []).slice(0, 24);
  } catch {
    return json({ error: "BAD_JSON" }, 400);
  }
  while (history.length && history[0].role !== "user") history.shift();
  if (!history.length || history[history.length - 1].role !== "user") return json({ error: "NO_USER_MESSAGE" }, 400);

  // 현재 화면에 떠 있는 곡 목록을 마지막 사용자 메시지에 데이터로 붙인다
  const list = shown.length
    ? shown.map((s, i) => `${i + 1}. ${String(s.title).slice(0, 120)} — ${String(s.channel).slice(0, 60)} (id: ${String(s.videoId).slice(0, 20)})`).join("\n")
    : "(비어 있음)";
  const last = history[history.length - 1];
  const messages = [
    ...history.slice(0, -1),
    { role: "user" as const, content: `${last.content}\n\n<현재_화면_곡_목록>\n${list}\n</현재_화면_곡_목록>` },
  ];

  const client = new Anthropic({ apiKey });
  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages,
    });

    if (response.stop_reason === "refusal") {
      return json({ reply: "그 요청은 도와드리기 어려워요. 듣고 싶은 분위기나 장르를 알려 주시면 곡을 골라 드릴게요.", search: "", select: "" });
    }
    const text = response.content.find((b) => b.type === "text");
    const parsed = JSON.parse(text && text.type === "text" ? text.text : "{}");
    const select = shown.some((s) => s.videoId === parsed.select) ? parsed.select : "";
    return json({ reply: String(parsed.reply ?? ""), search: String(parsed.search ?? "").slice(0, 100), select });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) {
      return json({ error: "RATE_LIMITED", reply: "요청이 몰려서 잠깐 쉬고 있어요. 조금 뒤에 다시 물어봐 주세요." }, 429);
    }
    if (e instanceof Anthropic.AuthenticationError) {
      return json({ error: "BAD_API_KEY", reply: "챗봇 API 키가 올바르지 않아요. ANTHROPIC_API_KEY를 확인해 주세요." }, 503);
    }
    console.error(e);
    return json({ error: "CHAT_FAILED", reply: "답장을 만들지 못했어요. 다시 한 번 말해 주세요." }, 500);
  }
});
