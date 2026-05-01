import { invoke } from "@tauri-apps/api/tauri";

export const tools = {
  navigate: (args: { route: string }) => invoke("ai_navigate", { route: args.route }),

  create_item: (args: { name: string }) => invoke("ai_create_item", { name: args.name }),

  approve_directory: (args: { path: string }) => invoke("ai_approve_directory", { path: args.path }),

  read_directory: (args: { path: string }) => invoke<string[]>("ai_read_directory", { path: args.path }),

  read_file: (args: { path: string }) => invoke<string>("ai_read_file", { path: args.path }),
};
