import { NextRequest, NextResponse } from "next/server";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type OpenAiChatRequest = {
  apiKey?: string;
  model?: string;
  systemPrompt?: string;
  messages?: ChatMessage[];
};

const extractOutputText = (response: unknown) => {
  if (
    response &&
    typeof response === "object" &&
    "output_text" in response &&
    typeof response.output_text === "string"
  ) {
    return response.output_text;
  }

  const output = response && typeof response === "object" && "output" in response ? response.output : null;
  if (!Array.isArray(output)) return "";

  return output
    .flatMap((item) => {
      if (!item || typeof item !== "object" || !("content" in item) || !Array.isArray(item.content)) return [];
      return (item.content as unknown[])
        .map((content: unknown) => {
          if (!content || typeof content !== "object") return "";
          if ("text" in content && typeof content.text === "string") return content.text;
          return "";
        })
        .filter(Boolean);
    })
    .join("\n")
    .trim();
};

export async function POST(request: NextRequest) {
  const body = (await request.json()) as OpenAiChatRequest;
  const apiKey = String(body.apiKey ?? "").trim();
  const model = String(body.model ?? "gpt-5").trim() || "gpt-5";
  const messages = Array.isArray(body.messages) ? body.messages.slice(-12) : [];

  if (!apiKey) {
    return NextResponse.json({ error: "OpenAI APIキーを入力してください" }, { status: 400 });
  }
  if (!messages.length || messages[messages.length - 1]?.role !== "user") {
    return NextResponse.json({ error: "送信するユーザーメッセージがありません" }, { status: 400 });
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        instructions: String(body.systemPrompt ?? ""),
        input: messages.map((message) => ({
          role: message.role,
          content: [{ type: "input_text", text: message.content }],
        })),
        max_output_tokens: 600,
        store: false,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(45000),
    });
    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: data?.error?.message ?? `OpenAI API が ${response.status} を返しました` },
        { status: response.status },
      );
    }

    const text = extractOutputText(data);
    if (!text) {
      return NextResponse.json({ error: "OpenAI APIから空の応答が返りました" }, { status: 502 });
    }

    return NextResponse.json({ text });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "OpenAI APIへの接続に失敗しました" },
      { status: 502 },
    );
  }
}
