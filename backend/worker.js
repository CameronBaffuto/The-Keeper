const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

const DEFAULT_CF_CHAT_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const DEFAULT_OPENAI_MODEL = "gpt-5-nano";
const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

function safeString(v) {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function getProvider(env) {
  const provider = safeString(env?.CHAT_PROVIDER || "cloudflare").trim().toLowerCase();
  return provider === "openai" ? "openai" : "cloudflare";
}

function toOpenAIInput(messages) {
  return messages.map((m) => ({
    role: m.role === "assistant" || m.role === "system" ? m.role : "user",
    content: [{ type: "input_text", text: safeString(m.content) }],
  }));
}

function extractOpenAIText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  if (Array.isArray(payload?.output_text)) {
    const joined = payload.output_text.map((v) => safeString(v)).join("").trim();
    if (joined) return joined;
  }

  if (Array.isArray(payload?.output)) {
    const chunks = [];
    for (const item of payload.output) {
      if (!Array.isArray(item?.content)) continue;
      for (const contentItem of item.content) {
        if (contentItem?.type === "output_text" && typeof contentItem?.text === "string") {
          chunks.push(contentItem.text);
        }
      }
    }
    const joined = chunks.join("").trim();
    if (joined) return joined;
  }

  const chatCompletionsText = payload?.choices?.[0]?.message?.content;
  return typeof chatCompletionsText === "string" ? chatCompletionsText.trim() : "";
}

async function callOpenAI({ env, messages, model, max_tokens, stream = false }) {
  const apiKey = safeString(env?.OPENAI_API_KEY).trim();
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY secret in Worker environment.");
  }

  const body = {
    model,
    input: toOpenAIInput(messages),
    max_output_tokens: max_tokens,
    stream,
  };

  const response = await fetch(OPENAI_RESPONSES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`OpenAI request failed (${response.status}): ${safeString(errText).slice(0, 500)}`);
  }

  if (stream) return response.body;

  const payload = await response.json();
  return { payload, text: extractOpenAIText(payload) };
}

function normalizeMessages(body) {
  let messages = body?.messages;
  const message = body?.message;

  if (!messages) {
    if (!message || typeof message !== "string") return null;
    messages = [{ role: "user", content: message }];
  }

  if (!Array.isArray(messages) || messages.length === 0) return null;

  return messages
    .map((m) => ({
      role: safeString(m?.role || "user"),
      content: safeString(m?.content || ""),
    }))
    .filter((m) => m.content.trim().length > 0);
}

function getLastUserQuestion(messages) {
  const lastUser = [...messages].reverse().find((m) => m.role === "user" && m.content.trim());
  return (lastUser?.content || "").trim();
}

function buildRetrievalQuery(messages, userTurns = 3) {
  const lastUserTurns = messages
    .filter((m) => m.role === "user" && m.content.trim())
    .slice(-userTurns)
    .map((m) => m.content.trim());

  return lastUserTurns.join("\n");
}

function buildDebugContext(messages, windowSize = 10) {
  const windowMessages = messages.slice(-windowSize);
  return windowMessages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n");
}

function buildRagContext(records, maxChars = 12000) {
  if (!Array.isArray(records) || records.length === 0) return "";

  const blocks = [];
  let used = 0;

  for (let i = 0; i < records.length; i += 1) {
    const record = records[i] || {};
    const filename = safeString(record.filename || record.source || `source-${i + 1}`);
    const score = typeof record.score === "number" ? record.score.toFixed(3) : "n/a";
    const snippet = safeString(
      record.content || record.text || record.chunk || record.snippet || record.excerpt || record.body || ""
    );
    const block = snippet
      ? `[${i + 1}] ${filename} (score: ${score})\n${snippet}`
      : `[${i + 1}] ${filename} (score: ${score})`;

    if (used + block.length > maxChars) break;
    blocks.push(block);
    used += block.length + 2;
  }

  return blocks.join("\n\n");
}

function buildOpenAIRagMessages({ question, retrievalQuery, ragContext, sourceFiles }) {
  const sourceList = sourceFiles.length ? sourceFiles.join(", ") : "(none)";
  const context = ragContext || "(no retrieved document snippets)";

  const system = [
    "You are The Keeper, a home knowledge assistant.",
    "Answer strictly from provided context.",
    "If context is missing or insufficient, return answer as NOT_FOUND.",
    "Return valid JSON only with keys: answer, sources, confidence, thread_status.",
    "confidence must be one of: low, medium, high.",
    "thread_status must include should_start_new_chat (boolean) and reason (string).",
    "sources must be an array of filenames actually used.",
  ].join(" ");

  const user = [
    `Question: ${question}`,
    `Retrieval query: ${retrievalQuery}`,
    `Retrieved source filenames: ${sourceList}`,
    "Context:",
    context,
  ].join("\n\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

async function aiSearchWithFallback(rag, query, max_num_results, score_threshold) {
  const pass1 = await rag.aiSearch({
    query,
    rewrite_query: true,
    max_num_results,
    ranking_options: { score_threshold },
    reranking: { enabled: true },
  });

  if (pass1?.data?.length) return pass1;

  const pass2 = await rag.aiSearch({
    query,
    rewrite_query: false,
    max_num_results: Math.max(5, max_num_results),
    ranking_options: { score_threshold: Math.min(0.45, score_threshold) },
    reranking: { enabled: true },
  });

  return pass2;
}

function extractSources(output) {
  const sources = (output?.data ?? []).map((d) => d?.filename).filter(Boolean);
  return [...new Set(sources)];
}

function heuristicConfidenceFromTopScore(topScore, hasSources) {
  if (typeof topScore === "number") {
    if (topScore >= 0.62) return "high";
    if (topScore >= 0.52) return "medium";
    return "low";
  }
  return hasSources ? "medium" : "low";
}

function normalizeModelResult(output) {
  const respVal = output?.response;

  let modelResult = null;
  let answerText = "";
  let parseError = null;

  if (respVal && typeof respVal === "object") {
    modelResult = respVal;
  } else if (typeof respVal === "string") {
    answerText = respVal.trim();

    if (answerText && answerText.toUpperCase() !== "NOT_FOUND") {
      try {
        modelResult = JSON.parse(answerText);
      } catch (e) {
        parseError = e?.message ?? String(e);
      }
    }
  } else {
    answerText = respVal == null ? "" : String(respVal).trim();
  }

  const modelAnswer = modelResult && typeof modelResult === "object" ? modelResult.answer : undefined;

  const isNotFound =
    (typeof answerText === "string" && answerText.toUpperCase() === "NOT_FOUND") ||
    (typeof modelAnswer === "string" && modelAnswer.toUpperCase() === "NOT_FOUND") ||
    (modelAnswer != null && String(modelAnswer).toUpperCase() === "NOT_FOUND");

  return { modelResult, answerText, parseError, isNotFound };
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const provider = getProvider(env);

      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }

      if (url.pathname === "/") {
        return new Response("ok", { status: 200 });
      }

      if (url.pathname === "/debug") {
        return json({
          provider,
          openaiModel: safeString(env.OPENAI_MODEL).trim() || DEFAULT_OPENAI_MODEL,
          hasOpenAIKey: !!safeString(env.OPENAI_API_KEY).trim(),
          hasWorkersAI: !!env.thekeeper_binding,
          hasAutorag: typeof env.thekeeper_binding?.autorag === "function",
        });
      }

      const isPublicPath = url.pathname === "/" || url.pathname === "/debug";
      if (!isPublicPath) {
        const auth = request.headers.get("Authorization") || "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";

        if (!token || token !== env.API_KEY) {
          return json({ error: "Unauthorized" }, 401);
        }
      }

      if (provider === "cloudflare" && !env.thekeeper_binding) {
        return json(
          {
            error:
              "Workers AI binding missing or misnamed. Ensure you added a Workers AI binding named 'thekeeper_binding'.",
          },
          500
        );
      }

      if (url.pathname === "/api/chat/stream") {
        if (request.method !== "POST") return json({ error: "Use POST" }, 405);

        const body = await request.json().catch(() => ({}));
        const messages = normalizeMessages(body);
        if (!messages) {
          return json({ error: "Provide `message` (string) or `messages` (array)" }, 400);
        }

        const requestedModel = typeof body?.model === "string" && body.model.trim() ? body.model.trim() : "";
        const model =
          requestedModel ||
          (provider === "openai"
            ? safeString(env.OPENAI_MODEL).trim() || DEFAULT_OPENAI_MODEL
            : DEFAULT_CF_CHAT_MODEL);
        const requestedMaxTokens = Number(body?.max_tokens);
        const max_tokens =
          Number.isFinite(requestedMaxTokens) && requestedMaxTokens > 0
            ? Math.min(Math.max(Math.floor(requestedMaxTokens), 64), 512)
            : 220;

        try {
          const stream =
            provider === "openai"
              ? await callOpenAI({ env, messages, model, max_tokens, stream: true })
              : await env.thekeeper_binding.run(model, {
                  messages,
                  stream: true,
                  max_tokens,
                });

          return new Response(stream, {
            status: 200,
            headers: {
              ...CORS_HEADERS,
              "Content-Type": "text/event-stream; charset=utf-8",
              "Cache-Control": "no-cache, no-transform",
              Connection: "keep-alive",
            },
          });
        } catch (error) {
          return json({ error: error?.message ?? "Streaming request failed" }, 500);
        }
      }

      if (url.pathname === "/api/chat" && typeof env.thekeeper_binding?.autorag !== "function") {
        return json(
          {
            error:
              "Workers AI binding missing or misnamed. Ensure you added a Workers AI binding named 'thekeeper_binding'.",
          },
          500
        );
      }

      const rag = url.pathname === "/api/chat" ? env.thekeeper_binding.autorag("thekeeper-rag") : null;

      if (url.pathname === "/api/chat") {
        if (request.method !== "POST") return json({ error: "Use POST" }, 405);

        const body = await request.json().catch(() => ({}));

        const messages = normalizeMessages(body);
        if (!messages) {
          return json({ error: "Provide `message` (string) or `messages` (array)" }, 400);
        }

        const question = getLastUserQuestion(messages);
        if (!question) return json({ error: "No user message found" }, 400);

        const windowSize = body.windowSize ?? 10;
        const debugContext = buildDebugContext(messages, windowSize);

        const retrievalQuery = buildRetrievalQuery(messages, body.userTurns ?? 3);
        const estimated_tokens = Math.ceil(retrievalQuery.length / 4);

        const max_num_results = body.max_num_results ?? 3;
        const score_threshold = body.score_threshold ?? 0.55;

        const output = await aiSearchWithFallback(rag, retrievalQuery, max_num_results, score_threshold);

        const uniqueSources = extractSources(output);
        const topScore = output?.data?.[0]?.score;

        const heuristicConfidence = heuristicConfidenceFromTopScore(topScore, uniqueSources.length > 0);
        let modelResult = null;
        let answerText = "";
        let parseError = null;
        let isNotFound = false;

        if (provider === "openai") {
          const requestedModel = typeof body?.model === "string" && body.model.trim() ? body.model.trim() : "";
          const model = requestedModel || safeString(env.OPENAI_MODEL).trim() || DEFAULT_OPENAI_MODEL;
          const ragContext = buildRagContext(output?.data ?? []);
          const openAIMessages = buildOpenAIRagMessages({
            question,
            retrievalQuery,
            ragContext,
            sourceFiles: uniqueSources,
          });

          const requestedMaxTokens = Number(body?.max_tokens);
          const max_tokens =
            Number.isFinite(requestedMaxTokens) && requestedMaxTokens > 0
              ? Math.min(Math.max(Math.floor(requestedMaxTokens), 128), 1024)
              : 420;

          const openAIResult = await callOpenAI({
            env,
            messages: openAIMessages,
            model,
            max_tokens,
            stream: false,
          });
          ({ modelResult, answerText, parseError, isNotFound } = normalizeModelResult({
            response: openAIResult.text,
          }));
        } else {
          ({ modelResult, answerText, parseError, isNotFound } = normalizeModelResult(output));
        }

        if (isNotFound) {
          return json({
            ok: true,
            question,
            result: {
              answer: "NOT_FOUND",
              sources: [],
              confidence: "low",
              thread_status: {
                should_start_new_chat: false,
                reason: "No matching info found in the indexed docs for this query.",
              },
            },
            meta: {
              estimated_tokens,
              windowSize,
              max_num_results,
              score_threshold,
              topScore: typeof topScore === "number" ? topScore : null,
              query_sent_to_aiSearch: retrievalQuery,
            },
          });
        }

        if (modelResult && typeof modelResult === "object") {
          const mergedSources =
            Array.isArray(modelResult.sources) && modelResult.sources.length ? modelResult.sources : uniqueSources;

          const mergedConfidence =
            modelResult.confidence === "low" || modelResult.confidence === "medium" || modelResult.confidence === "high"
              ? modelResult.confidence
              : heuristicConfidence;

          return json({
            ok: true,
            question,
            result: {
              ...modelResult,
              sources: mergedSources,
              confidence: mergedConfidence,
            },
            meta: {
              estimated_tokens,
              windowSize,
              max_num_results,
              score_threshold,
              topScore: typeof topScore === "number" ? topScore : null,
              query_sent_to_aiSearch: retrievalQuery,
            },
          });
        }

        const debug = url.searchParams.get("debug") === "1" || body.debug === true;

        return json({
          ok: true,
          question,
          result: {
            answer: answerText || "NOT_FOUND",
            sources: uniqueSources,
            confidence: heuristicConfidence,
            thread_status: {
              should_start_new_chat: false,
              reason: "Model response was not valid JSON; returning raw text.",
            },
          },
          meta: {
            estimated_tokens,
            windowSize,
            max_num_results,
            score_threshold,
            topScore: typeof topScore === "number" ? topScore : null,
            parseError,
            query_sent_to_aiSearch: retrievalQuery,
            ...(debug ? { debug_context: debugContext } : {}),
          },
          ...(debug ? { raw: output } : {}),
        });
      }

      return json({ error: "Not found" }, 404);
    } catch (err) {
      return json(
        {
          ok: false,
          error: "Worker exception",
          message: err?.message ?? String(err),
          stack: err?.stack ?? null,
        },
        500
      );
    }
  },
};
