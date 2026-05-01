type TauriInvoker = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export function isTauriRuntimeAvailable() {
  return Boolean((window as Window & { __TAURI__?: { core?: { invoke?: TauriInvoker } } }).__TAURI__?.core?.invoke);
}

function getTauriInvoke(): TauriInvoker {
  const tauriInvoke = (window as Window & { __TAURI__?: { core?: { invoke?: TauriInvoker } } }).__TAURI__?.core?.invoke;

  if (!tauriInvoke) {
    throw new Error("Tauri invoke API is unavailable. Run inside the Tauri desktop runtime.");
  }

  return tauriInvoke;
}

export const tools = {
  navigate: (args: { route: string }) => getTauriInvoke()("ai_navigate", { route: args.route }),

  create_item: (args: { name: string }) => getTauriInvoke()("ai_create_item", { name: args.name }),

  approve_directory: (args: { path: string }) => getTauriInvoke()("ai_approve_directory", { path: args.path }),

  read_directory: async (args: { path: string }) => {
    const result = await getTauriInvoke()("ai_read_directory", { path: args.path });
    return result as string[];
  },

  read_file: async (args: { path: string }) => {
    const result = await getTauriInvoke()("ai_read_file", { path: args.path });
    return result as string;
  },
};
