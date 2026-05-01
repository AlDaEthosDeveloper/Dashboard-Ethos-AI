import { getAIContext } from "./snapshot";
import { tools } from "./tools";

type OpenAIToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export async function runAIAgent(question: string): Promise<string> {
  const apiKey = import.meta.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY environment variable.");
  }

  const context = getAIContext();

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are an AI assistant running INSIDE a Tauri desktop app.\nYou are given the current DOM text and page info.\nYou may call tools to interact with the app when needed.\nOtherwise, answer the user directly.",
        },
        {
          role: "user",
          content: JSON.stringify({ question, context }),
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "navigate",
            description: "Navigate to a route in the Tauri app",
            parameters: {
              type: "object",
              properties: {
                route: { type: "string" },
              },
              required: ["route"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "create_item",
            description: "Create an item in the app",
            parameters: {
              type: "object",
              properties: {
                name: { type: "string" },
              },
              required: ["name"],
            },
          },
        },
      ],
      tool_choice: "auto",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const message = data?.choices?.[0]?.message;
  const toolCalls = (message?.tool_calls ?? []) as OpenAIToolCall[];

  if (toolCalls.length > 0) {
    for (const toolCall of toolCalls) {
      const args = JSON.parse(toolCall.function.arguments || "{}");

      if (toolCall.function.name === "navigate") {
        await tools.navigate(args as { route: string });
      } else if (toolCall.function.name === "create_item") {
        await tools.create_item(args as { name: string });
      }
    }

    return "Action completed.";
  }

  return message?.content ?? "";
}

export async function askAI(question: string) {
  return await runAIAgent(question);
}
