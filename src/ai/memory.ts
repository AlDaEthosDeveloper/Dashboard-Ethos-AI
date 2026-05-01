export type Memory = {
  summary: string;
  source: string;
  timestamp: string;
};

const memories: Memory[] = [];

export function addMemory(m: Memory) {
  memories.push(m);
}

export function getMemories() {
  return memories;
}
