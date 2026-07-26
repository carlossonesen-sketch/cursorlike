export interface PatchHunk {
  id: string;
  filePath: string;
  fileHeader: string;
  header: string;
  body: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  kind: "create" | "modify" | "delete";
}

const FILE_START = /^---\s+(?:a\/|\/dev\/null)/;
const HUNK_HEADER = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;

export function parsePatchHunks(patch: string): PatchHunk[] {
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  const hunks: PatchHunk[] = [];
  let index = 0;
  while (index < lines.length) {
    if (!FILE_START.test(lines[index] ?? "")) {
      index += 1;
      continue;
    }
    const oldHeader = lines[index] ?? "";
    const newHeader = lines[index + 1] ?? "";
    const oldPath = oldHeader.replace(/^---\s+(?:a\/)?/, "").trim();
    const newPath = newHeader.replace(/^\+\+\+\s+(?:b\/)?/, "").trim();
    const filePath = newPath === "/dev/null" ? oldPath : newPath;
    const kind = oldPath === "/dev/null" ? "create" : newPath === "/dev/null" ? "delete" : "modify";
    const fileHeader = `${oldHeader}\n${newHeader}`;
    index += 2;
    let ordinal = 0;
    while (index < lines.length && !FILE_START.test(lines[index] ?? "")) {
      const match = HUNK_HEADER.exec(lines[index] ?? "");
      if (!match) {
        index += 1;
        continue;
      }
      const header = lines[index]!;
      const body: string[] = [];
      index += 1;
      while (
        index < lines.length &&
        !HUNK_HEADER.test(lines[index] ?? "") &&
        !FILE_START.test(lines[index] ?? "")
      ) {
        body.push(lines[index]!);
        index += 1;
      }
      ordinal += 1;
      hunks.push({
        id: `${filePath}::${ordinal}::${match[1]}:${match[3]}`,
        filePath,
        fileHeader,
        header,
        body: body.join("\n"),
        oldStart: Number(match[1]),
        oldLines: Number(match[2] ?? 1),
        newStart: Number(match[3]),
        newLines: Number(match[4] ?? 1),
        kind,
      });
    }
  }
  return hunks;
}

export function patchFromSelectedHunks(patch: string, selectedIds: Iterable<string>): string {
  const selected = new Set(selectedIds);
  const hunks = parsePatchHunks(patch).filter((hunk) => selected.has(hunk.id));
  const files = new Map<string, { header: string; hunks: PatchHunk[] }>();
  for (const hunk of hunks) {
    const entry = files.get(hunk.filePath) ?? { header: hunk.fileHeader, hunks: [] };
    entry.hunks.push(hunk);
    files.set(hunk.filePath, entry);
  }
  return [...files.values()]
    .map(({ header, hunks: fileHunks }) =>
      [header, ...fileHunks.flatMap((hunk) => [hunk.header, hunk.body])].join("\n").trimEnd()
    )
    .join("\n");
}

export function selectedHunksPreserveFileSemantics(
  patch: string,
  selectedIds: Iterable<string>
): { valid: boolean; error?: string } {
  const selected = new Set(selectedIds);
  const hunks = parsePatchHunks(patch);
  for (const filePath of new Set(hunks.map((hunk) => hunk.filePath))) {
    const fileHunks = hunks.filter((hunk) => hunk.filePath === filePath);
    if (
      fileHunks[0]?.kind !== "modify" &&
      fileHunks.some((hunk) => selected.has(hunk.id)) &&
      fileHunks.some((hunk) => !selected.has(hunk.id))
    ) {
      return {
        valid: false,
        error: `${filePath} is a ${fileHunks[0]?.kind} patch; all of its hunks must be selected together.`,
      };
    }
  }
  return { valid: true };
}
