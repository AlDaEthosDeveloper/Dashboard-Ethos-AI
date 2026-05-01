import { isLearningMode, setLearningMode } from "./learningState";
import { addMemory, getMemories } from "./memory";
import { approveDir, getApprovedDirs, isApproved } from "./permissions";
import { getAIContext } from "./snapshot";
import { isTauriRuntimeAvailable, tools } from "./tools";


const OPENAI_KEY_STORAGE_KEY = "AI_COPILOT_OPENAI_API_KEY";

function getOpenAIKey() {
  const storedKey = typeof window !== "undefined" ? window.localStorage.getItem(OPENAI_KEY_STORAGE_KEY) : null;
  return storedKey || import.meta.env.OPENAI_API_KEY || import.meta.env.VITE_OPENAI_API_KEY;
}

export function setOpenAIKey(apiKey: string) {
  if (typeof window === "undefined") return;
  if (!apiKey.trim()) {
    window.localStorage.removeItem(OPENAI_KEY_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(OPENAI_KEY_STORAGE_KEY, apiKey.trim());
}

type OpenAIToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

function shouldLearn(question: string) {
  const lowered = question.toLowerCase();
  return lowered.includes("learn this database") || lowered.includes("study this folder");
}

async function summarizeForMemory(source: string, content: string): Promise<string> {
  const apiKey = getOpenAIKey();

  if (!apiKey) {
    throw new Error("Missing OpenAI API key. Set it in Settings below or configure VITE_OPENAI_API_KEY.");
  }

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
          content: "Summarize what is important to remember about how this app works.",
        },
        {
          role: "user",
          content: JSON.stringify({ source, content: content.slice(0, 20000) }),
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

export async function teachAI(path: string): Promise<string> {
  if (!isTauriRuntimeAvailable()) {
    return "Learning from folders requires the Tauri desktop runtime.";
  }

  if (!isLearningMode()) {
    return "Learning mode is disabled.";
  }

  if (!isApproved(path)) {
    return "Directory is not approved.";
  }

  const files = await tools.read_directory({ path });

  for (const filePath of files) {
    const content = await tools.read_file({ path: filePath });
    const summary = await summarizeForMemory(filePath, content);
    addMemory({
      summary,
      source: filePath,
      timestamp: new Date().toISOString(),
    });
  }

  return `Learned from ${files.length} file(s).`;
}

export async function runAIAgent(question: string): Promise<string> {
  const apiKey = getOpenAIKey();

  if (!apiKey) {
    throw new Error("Missing OpenAI API key. Set it in Settings below or configure VITE_OPENAI_API_KEY.");
  }

  if (isLearningMode() && shouldLearn(question)) {
    const firstApprovedPath = getApprovedDirs()[0];
    if (!firstApprovedPath) {
      return "No approved directory available for learning.";
    }
    return teachAI(firstApprovedPath);
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
          content: JSON.stringify({ question, context, memories: getMemories() }),
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


export function enableLearningMode(enabled = true) {
  setLearningMode(enabled);
}

export async function approveDirectory(path: string) {
  if (!isTauriRuntimeAvailable()) {
    throw new Error("Folder actions require running inside the Tauri desktop app.");
  }

  approveDir(path);
  await tools.approve_directory({ path });
}

export async function askAI(question: string) {
  return await runAIAgent(question);
}
