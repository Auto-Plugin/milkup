import type { AIConfig } from "@/renderer/hooks/useAIConfig";

export interface APIContext {
  fileTitle?: string;
  sectionTitle?: string;
  subSectionTitle?: string;
  previousContent: string;
}

export interface CompletionResponse {
  continuation: string;
}

const SYSTEM_PROMPT = `你是一个技术文档续写助手。
严格只输出以下 JSON，**不要有任何前缀、后缀、markdown、换行、解释**：

{"continuation": "接下来只写3–35个汉字的自然衔接内容"}
`;

const RESPONSE_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "short_continuation",
    strict: true,
    schema: {
      type: "object",
      properties: {
        continuation: {
          type: "string",
          description: "3–35 个汉字的续写",
          minLength: 2,
          maxLength: 35,
        },
      },
      required: ["continuation"],
      additionalProperties: false,
    },
  },
};

export class AIService {
  private static async request(url: string, options: RequestInit): Promise<any> {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        let errorMsg = `HTTP Error: ${response.status}`;
        try {
          const errorBody = await response.json();
          errorMsg += ` - ${JSON.stringify(errorBody)}`;
        } catch {
          errorMsg += ` - ${await response.text()}`;
        }
        throw new Error(errorMsg);
      }
      return await response.json();
    } catch (error: any) {
      console.error("[AI Service] Request failed:", error);
      throw error;
    }
  }

  private static buildPrompt(context: APIContext): string {
    return `上下文：
文章标题：${context.fileTitle || "未知"}
大标题：${context.sectionTitle || "未知"}
本小节标题：${context.subSectionTitle || "未知"}
前面内容（请紧密衔接）：${context.previousContent}`;
  }

  private static parseResponse(text: string): CompletionResponse {
    try {
      // 1. Try generic JSON parsing
      // Remove generic markdown code block if present
      const cleanText = text.replace(/```json\n?|\n?```/g, "").trim();
      const json = JSON.parse(cleanText);
      if (json.continuation) {
        return { continuation: json.continuation };
      }
    } catch (e) {
      console.warn("[AI Service] JSON parse failed, trying regex extraction", e);
    }

    // 2. Regex fallback
    const match = text.match(/"continuation"\s*:\s*"([^"]+)"/);
    if (match && match[1]) {
      return { continuation: match[1] };
    }

    // 3. Last resort fallback (if AI just returned text)
    if (text.length < 50 && !text.includes("{")) {
      return { continuation: text.trim() };
    }

    throw new Error("Failed to parse AI response");
  }

  static async testConnection(config: AIConfig): Promise<boolean> {
    if (!config.baseUrl) throw new Error("Base URL is required");

    switch (config.provider) {
      case "ollama":
        try {
          // Check tags for Ollama
          await this.request(`${config.baseUrl}/api/tags`, { method: "GET" });
          return true;
        } catch {
          return false;
        }
      default:
        // For others, we might try a minimal model list call or just assume verified if user saves?
        // Let's try to list models for OpenAI compatible APIs
        if (config.provider === "openai" || config.provider === "custom") {
          try {
            await this.request(`${config.baseUrl}/models`, {
              headers: { Authorization: `Bearer ${config.apiKey}` },
            });
            return true;
          } catch {
            // Some endpoints might not support /models, maybe try a tiny completion?
            // But usually /models is standard.
            return false;
          }
        }
        return true; // Fallback for Anthropic/Gemini verification implementation later if needed
    }
  }

  static async getModels(config: AIConfig): Promise<string[]> {
    if (config.provider === "ollama") {
      try {
        const res = await this.request(`${config.baseUrl}/api/tags`, { method: "GET" });
        return res.models?.map((m: any) => m.name) || [];
      } catch (e) {
        console.error("Failed to fetch Ollama models", e);
        return [];
      }
    }
    return [];
  }

  static async complete(config: AIConfig, context: APIContext): Promise<CompletionResponse> {
    const userMessage = this.buildPrompt(context);

    let url = "";
    let headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    let body: any = {};

    switch (config.provider) {
      case "openai":
      case "custom":
        url = `${config.baseUrl}/chat/completions`;
        headers["Authorization"] = `Bearer ${config.apiKey}`;
        body = {
          model: config.model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userMessage },
          ],
          temperature: config.temperature,
          stream: false,
          // OpenAI Structured Outputs
          response_format: RESPONSE_SCHEMA,
        };
        break;

      case "anthropic":
        url = `${config.baseUrl}/v1/messages`;
        headers["x-api-key"] = config.apiKey;
        headers["anthropic-version"] = "2023-06-01";
        // Anthropic doesn't have "response_format" in the same way, but we can stick to prompt engineering
        // OR use tool use if we wanted strict enforcement, but for simple completion, prompt is often enough.
        // However, user asked to use API level restrictions if available.
        // Anthropic specific: prefill assistant message to force JSON, or use tools.
        // Let's use the tool constraint approach which is the "Standard" way for structured output in Claude now.

        const toolSchema = {
          name: "print_continuation",
          description: "Print the continuation text",
          input_schema: {
            type: "object",
            properties: {
              continuation: {
                type: "string",
                description: "3–35 个汉字的续写",
              },
            },
            required: ["continuation"],
          },
        };

        body = {
          model: config.model,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: userMessage }],
          max_tokens: 1024,
          stream: false,
          tools: [toolSchema],
          tool_choice: { type: "tool", name: "print_continuation" },
        };
        break;

      case "gemini":
        // Gemini API Structured Output
        url = `${config.baseUrl}/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`;
        body = {
          contents: [
            {
              parts: [{ text: SYSTEM_PROMPT + "\n" + userMessage }],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                continuation: { type: "STRING" },
              },
              required: ["continuation"],
            },
            maxOutputTokens: 1024,
          },
        };
        break;

      case "ollama":
        url = `${config.baseUrl}/api/chat`;
        body = {
          model: config.model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userMessage },
          ],
          // Ollama supports JSON Schema object in 'format' since v0.5.x
          format: RESPONSE_SCHEMA.json_schema.schema,
          stream: false,
          options: {
            temperature: config.temperature,
          },
        };
        break;
    }

    const response = await this.request(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    let content = "";

    if (config.provider === "openai" || config.provider === "custom") {
      content = response.choices?.[0]?.message?.content || "";
    } else if (config.provider === "anthropic") {
      // Handle tool use response
      if (response.content) {
        const toolUse = response.content.find((c: any) => c.type === "tool_use");
        if (toolUse && toolUse.input) {
          // Directly return parsed input as it is already JSON object
          if (toolUse.input.continuation) {
            return { continuation: toolUse.input.continuation };
          }
        }
        // Fallback to text if tool wasn't used properly (unlikely with tool_choice forced)
        content = response.content.find((c: any) => c.type === "text")?.text || "";
      }
    } else if (config.provider === "gemini") {
      content = response.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } else if (config.provider === "ollama") {
      content = response.message?.content || "";
    }

    return this.parseResponse(content);
  }
}
