const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

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

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      // CORS preflight
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }

      // Health check
      if (url.pathname === "/") {
        return new Response("ok", { status: 200 });
      }

      // Debug binding visibility (optional)
      if (url.pathname === "/debug") {
        return json({
          hasWorkersAI: !!env.thekeeper_binding,
          hasAutorag: typeof env.thekeeper_binding?.autorag === "function",
        });
      }

      // Bearer token auth (protect everything except / and /debug)
      const isPublicPath = url.pathname === "/" || url.pathname === "/debug";
      if (!isPublicPath) {
        const auth = request.headers.get("Authorization") || "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";

        if (!token || token !== env.API_KEY) {
          return json({ error: "Unauthorized" }, 401);
        }
      }

      // Ensure binding exists
      if (!env.thekeeper_binding || typeof env.thekeeper_binding.autorag !== "function") {
        return json(
          {
            error:
              "Workers AI binding missing or misnamed. Ensure you added a Workers AI binding named 'thekeeper_binding'.",
          },
          500
        );
      }

      const rag = env.thekeeper_binding.autorag("thekeeper-rag");

      // -------------------------
      // POST /api/chat
      // -------------------------
      if (url.pathname === "/api/chat") {
        if (request.method !== "POST") return json({ error: "Use POST" }, 405);

        const body = await request.json().catch(() => ({}));

        let messages = body.messages;
        const message = body.message;

        if (!messages) {
          if (!message || typeof message !== "string") {
            return json({ error: "Provide `message` (string) or `messages` (array)" }, 400);
          }
          messages = [{ role: "user", content: message }];
        }

        if (!Array.isArray(messages) || messages.length === 0) {
          return json({ error: "`messages` must be a non-empty array" }, 400);
        }

        const lastUser = [...messages].reverse().find(
          (m) => m && m.role === "user" && typeof m.content === "string" && m.content.trim()
        );
        const question = (lastUser?.content || "").trim();
        if (!question) return json({ error: "No user message found" }, 400);

        // ---- Context window (for follow-ups)
        const windowSize = body.windowSize ?? 10; // last ~5 turns
        const windowMessages = messages.slice(-windowSize);

        const contextQuery = windowMessages
          .map((m) => `${String(m.role || "user").toUpperCase()}: ${String(m.content || "")}`)
          .join("\n");

        // Cheap token estimate (~4 chars/token)
        const estimated_tokens = Math.ceil(contextQuery.length / 4);

        // Retrieval tuning (override dashboard defaults)
        const max_num_results = body.max_num_results ?? 3;
        const score_threshold = body.score_threshold ?? 0.55;

        const output = await rag.aiSearch({
          query: contextQuery,
          rewrite_query: true,
          max_num_results,
          ranking_options: { score_threshold },
          reranking: { enabled: true },
        });

        // Extract sources from retrieval results
        const sources = (output?.data ?? []).map((d) => d?.filename).filter(Boolean);
        const uniqueSources = [...new Set(sources)];

        // Confidence heuristic (only used as fallback)
        const topScore = output?.data?.[0]?.score;
        const heuristicConfidence =
          typeof topScore === "number"
            ? topScore >= 0.62
              ? "high"
              : topScore >= 0.52
              ? "medium"
              : "low"
            : uniqueSources.length
            ? "medium"
            : "low";

        // --- Normalize model output: AI Search may return response as string OR object
        let modelResult = null;
        let answerText = "";
        let parseError = null;

        const respVal = output?.response;

        // Case 1: response is already an object
        if (respVal && typeof respVal === "object") {
          modelResult = respVal;
        }
        // Case 2: response is a string (your system prompt expects JSON or NOT_FOUND)
        else if (typeof respVal === "string") {
          answerText = respVal.trim();

          if (answerText !== "NOT_FOUND") {
            try {
              modelResult = JSON.parse(answerText);
            } catch (e) {
              parseError = e?.message ?? String(e);
            }
          }
        }
        // Case 3: unknown type
        else {
          answerText = respVal == null ? "" : String(respVal).trim();
        }

        // Standard NOT_FOUND output
        if (answerText === "NOT_FOUND") {
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
              query_sent_to_aiSearch: contextQuery,
            },
          });
        }

        // Prefer model JSON result (object or parsed JSON string)
        if (modelResult && typeof modelResult === "object") {
          const mergedSources =
            Array.isArray(modelResult.sources) && modelResult.sources.length
              ? modelResult.sources
              : uniqueSources;

          const mergedConfidence =
            modelResult.confidence === "low" ||
            modelResult.confidence === "medium" ||
            modelResult.confidence === "high"
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
              query_sent_to_aiSearch: contextQuery,
            },
          });
        }

        // Fallback if model didn't return valid JSON (should be rare)
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
            query_sent_to_aiSearch: contextQuery,
          },
          ...(debug ? { raw: output } : {}),
        });
      }

      // Unknown route
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
