let approvedDirs: string[] = [];

export function approveDir(path: string) {
  if (!approvedDirs.includes(path)) {
    approvedDirs.push(path);
  }
}

export function isApproved(path: string) {
  return approvedDirs.some((p) => path.startsWith(p));
}

export function getApprovedDirs() {
  return approvedDirs;
}
