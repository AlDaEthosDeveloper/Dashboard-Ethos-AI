import {
  readDir as pluginReadDir,
  readFile as pluginReadFile,
  readTextFile as pluginReadTextFile,
  stat as pluginStat,
  writeTextFile as pluginWriteTextFile,
} from '@tauri-apps/plugin-fs';

type TauriInternals = {
  invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
};

/**
 * Retrieves data for `getInternals`.
 *
 * @param args Function input.
 * @returns Retrieved value.
 */
const getInternals = (): TauriInternals | null => {
  const runtime = window as unknown as { __TAURI_INTERNALS__?: TauriInternals };
  return runtime.__TAURI_INTERNALS__ ?? null;
};

/**
 * Evaluates whether `isTauriRuntime` conditions are met.
 *
 * @param args Function input.
 * @returns Boolean evaluation result.
 */
export const isTauriRuntime = () => Boolean(getInternals()?.invoke);

const invoke = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
  const internals = getInternals();
  if (!internals?.invoke) {
    throw new Error('Tauri runtime not available');
  }

  return internals.invoke(command, args) as Promise<T>;
};

const getErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error)).toLowerCase();

const shouldFallbackToInvoke = (error: unknown) => {
  const message = getErrorMessage(error);
  return message.includes('missing file path') || message.includes('path') || message.includes('tauri runtime not available');
};

export const tauriPath = {
  join: (...paths: string[]) => invoke<string>('plugin:path|join', { paths }),
  dirname: (path: string) => invoke<string>('plugin:path|dirname', { path }),
  resolveDirectory: (directory: 'AppConfig' | 'AppData' | 'Desktop' | 'Executable', path: string = '') => {
    const directoryCodeByName: Record<'AppConfig' | 'AppData' | 'Desktop' | 'Executable', number> = {
      AppConfig: 13,
      AppData: 14,
      Desktop: 18,
      Executable: 19,
    };
    return invoke<string>('plugin:path|resolve_directory', { directory: directoryCodeByName[directory], path });
  },
  executableDir: async () => {
    try {
      return await tauriPath.resolveDirectory('Executable', '');
    } catch {
      return invoke<string>('executable_dir_fallback');
    }
  },
  appConfigDir: () => tauriPath.resolveDirectory('AppConfig', ''),
  appDataDir: () => tauriPath.resolveDirectory('AppData', ''),
  desktopDir: () => tauriPath.resolveDirectory('Desktop', ''),
};

export type TauriDirEntry = {
  name?: string;
  isFile?: boolean;
  isDirectory?: boolean;
  children?: TauriDirEntry[];
  path?: string;
};

export const tauriFs = {
  readTextFile: async (path: string) => {
    try {
      return await pluginReadTextFile(path);
    } catch (error) {
      if (!shouldFallbackToInvoke(error)) throw error;
      return invoke<string>('plugin:fs|read_text_file', { path });
    }
  },
  writeTextFile: async (path: string, contents: string) => {
    try {
      await pluginWriteTextFile(path, contents);
    } catch (error) {
      if (!shouldFallbackToInvoke(error)) throw error;
      await invoke<void>('plugin:fs|write_text_file', { path, contents });
    }
  },
  readBinaryFile: async (path: string) => {
    try {
      return Array.from(await pluginReadFile(path));
    } catch (error) {
      if (!shouldFallbackToInvoke(error)) throw error;
      return invoke<number[]>('plugin:fs|read_file', { path });
    }
  },
  readDir: async (path: string, recursive: boolean = false) => {
    try {
      return (await pluginReadDir(path, { recursive })) as unknown as TauriDirEntry[];
    } catch (error) {
      if (!shouldFallbackToInvoke(error)) throw error;
      return invoke<TauriDirEntry[]>('plugin:fs|read_dir', { path, options: { recursive } });
    }
  },
  getModifiedAt: async (path: string): Promise<number | null> => {
    try {
      const metadata = await pluginStat(path);
      const raw = metadata?.mtime ?? metadata?.modifiedAt;
      if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
      if (typeof raw === 'string' && raw.trim()) {
        const parsed = new Date(raw).getTime();
        return Number.isFinite(parsed) ? parsed : null;
      }
    } catch (error) {
      if (!shouldFallbackToInvoke(error)) return null;
      try {
        const metadata = await invoke<{ mtime?: string | number | null; modifiedAt?: string | number | null }>('plugin:fs|stat', { path });
        const raw = metadata?.mtime ?? metadata?.modifiedAt;
        if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
        if (typeof raw === 'string' && raw.trim()) {
          const parsed = new Date(raw).getTime();
          return Number.isFinite(parsed) ? parsed : null;
        }
      } catch {}
    }
    return null;
  },
};
