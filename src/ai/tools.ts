import { invoke } from "@tauri-apps/api/tauri";

export const tools = {
  navigate: (args: { route: string }) => invoke("ai_navigate", { route: args.route }),

  create_item: (args: { name: string }) => invoke("ai_create_item", { name: args.name }),
};
