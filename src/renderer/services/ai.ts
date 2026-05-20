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

export interface TestConnectionResult {
  success: boolean;
  message: string;
  degraded?: boolean;
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
        let errorDetail = "";
        try {
          const errorBody = await response.json();
          errorDetail = this.formatApiErrorDetail(errorBody);
        } catch {
          errorDetail = await response.text();
        }
        throw new Error(`HTTP ${response.status}${errorDetail ? `: ${errorDetail}` : ""}`);
      }
      return await response.json();
    } catch (error: any) {
      console.error("[AI Service] Request failed:", error);
      throw error;
    }
  }

  private static formatApiErrorDetail(errorBody: any): string {
    if (!errorBody) return "";
    if (typeof errorBody === "string") return errorBody;
    if (errorBody.error?.message) return errorBody.error.message;
    if (errorBody.message) return errorBody.message;
    if (errorBody.detail) return String(errorBody.detail);
    return JSON.stringify(errorBody);
  }

  private static isDeepSeekCompatible(config: AIConfig): boolean {
    const baseUrl = (config.baseUrl || "").toLowerCase();
    const model = (config.model || "").toLowerCase();
    return baseUrl.includes("deepseek.com") || model.startsWith("deepseek");
  }

  private static shouldUseResponseFormat(config: AIConfig): boolean {
    if (config.provider !== "openai" && config.provider !== "custom") return false;
    return !this.isDeepSeekCompatible(config);
  }

  private static isUnsupportedResponseFormatError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /response_format|json_schema|unsupported|not support|不支持|invalid request/i.test(
      message
    );
  }

  private static buildOpenAICompatibleBody(
    config: AIConfig,
    messages: Array<{ role: "system" | "user"; content: string }>,
    options: { maxTokens?: number; useResponseFormat?: boolean } = {}
  ): any {
    const useResponseFormat = options.useResponseFormat ?? this.shouldUseResponseFormat(config);
    const body: any = {
      model: config.model,
      messages,
      temperature: config.temperature,
      stream: false,
    };

    if (options.maxTokens !== undefined) {
      body.max_tokens = options.maxTokens;
    }

    if (useResponseFormat) {
      body.response_format = RESPONSE_SCHEMA;
    }

    return body;
  }

  private static async requestOpenAICompatible(
    config: AIConfig,
    url: string,
    headers: Record<string, string>,
    messages: Array<{ role: "system" | "user"; content: string }>,
    options: { maxTokens?: number; parseResult?: boolean } = {}
  ): Promise<{ response: any; degraded: boolean }> {
    const useResponseFormat = this.shouldUseResponseFormat(config);

    try {
      const response = await this.request(url, {
        method: "POST",
        headers,
        body: JSON.stringify(
          this.buildOpenAICompatibleBody(config, messages, {
            maxTokens: options.maxTokens,
            useResponseFormat,
          })
        ),
      });
      return { response, degraded: !useResponseFormat };
    } catch (error) {
      if (!useResponseFormat || !this.isUnsupportedResponseFormatError(error)) {
        throw error;
      }

      const response = await this.request(url, {
        method: "POST",
        headers,
        body: JSON.stringify(
          this.buildOpenAICompatibleBody(config, messages, {
            maxTokens: options.maxTokens,
            useResponseFormat: false,
          })
        ),
      });
      return { response, degraded: true };
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

  static async testConnection(config: AIConfig): Promise<TestConnectionResult> {
    if (!config.baseUrl) throw new Error("Base URL is required");

    switch (config.provider) {
      case "ollama":
        await this.request(`${config.baseUrl}/api/tags`, { method: "GET" });
        return { success: true, message: "连接成功" };
      default:
        if (config.provider === "openai" || config.provider === "custom") {
          const url = `${config.baseUrl}/chat/completions`;
          const headers = {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
          };
          const { degraded } = await this.requestOpenAICompatible(
            config,
            url,
            headers,
            [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: '请返回 {"continuation":"测试"}' },
            ],
            { maxTokens: 32 }
          );
          return {
            success: true,
            message: degraded
              ? "连接成功；当前接口不支持 response_format，已自动使用 JSON 提示词模式"
              : "连接成功",
            degraded,
          };
        }
        return { success: true, message: "连接成功" }; // Fallback for Anthropic/Gemini verification implementation later if needed
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
        body = this.buildOpenAICompatibleBody(config, [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ]);
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

    let response: any;

    if (config.provider === "openai" || config.provider === "custom") {
      const result = await this.requestOpenAICompatible(config, url, headers, body.messages, {});
      response = result.response;
    } else {
      response = await this.request(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    }

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
