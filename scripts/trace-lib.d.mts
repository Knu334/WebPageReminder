export function plain(s: string, max?: number): string;
export function escapeCell(s: string): string;
export function parseSpec(text: string): { reqs: { id: string; section: string; desc: string }[]; duplicates: string[]; multiTag: string[] };
export function extractIds(name: string): string[];
export function stripIdPrefix(segment: string): string;
export function unknownIds(tests: { file: string; name: string; ids: string[] }[], specIds: string[]): string[];
