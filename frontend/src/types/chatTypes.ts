export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type ChatRequest =
  | { message: string }
  | { messages: ChatMessage[] };

export type ChatResult = {
  answer: string;
  sources: string[];
  confidence: "low" | "medium" | "high" | string;
  thread_status?: {
    should_start_new_chat: boolean;
    reason: string;
  };
};

export type ChatResponse = {
  ok: boolean;
  question: string;
  result: ChatResult;
  meta?: {
    estimated_tokens?: number;
    windowSize?: number;
    max_num_results?: number;
    score_threshold?: number;
    topScore?: number;
    query_sent_to_aiSearch?: string;
    [key: string]: unknown;
  };
};
