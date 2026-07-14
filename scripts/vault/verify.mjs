import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const vaultRoot = join(repositoryRoot, "vault");
const excludedDirectoryNames = new Set([".git", ".obsidian", "node_modules"]);
const excludedDirectoryPrefixes = [
  "fixtures/consent-records",
  "fixtures/incoming",
  "fixtures/local",
  "spikes/dji-parser/internal-build/out",
  "spikes/dji-parser/internal-build/work",
];

function excludedDirectory(path) {
  if (excludedDirectoryNames.has(basename(path))) return true;
  const repositoryPath = relative(repositoryRoot, path);
  return excludedDirectoryPrefixes.some((prefix) => (
    repositoryPath === prefix || repositoryPath.startsWith(`${prefix}/`)
  ));
}

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? excludedDirectory(path) ? [] : markdownFiles(path)
      : extname(entry.name) === ".md"
        ? [path]
        : [];
  });
}

const repositoryMarkdown = markdownFiles(repositoryRoot);
const vaultMarkdown = repositoryMarkdown.filter((path) => path.startsWith(`${vaultRoot}/`));
const noteNames = new Map();

for (const path of repositoryMarkdown) {
  const name = basename(path, ".md");
  noteNames.set(name, [...(noteNames.get(name) ?? []), path]);
}

const errors = [];
for (const path of vaultMarkdown) {
  const value = readFileSync(path, "utf8");
  const displayPath = relative(repositoryRoot, path);
  if (!value.startsWith("---\n")) errors.push(`${displayPath}: missing YAML frontmatter at line 1`);
  const frontmatterEnd = value.indexOf("\n---\n", 4);
  const frontmatter = frontmatterEnd >= 0 ? value.slice(4, frontmatterEnd) : "";
  if (!/^type:\s*\S+/m.test(frontmatter)) errors.push(`${displayPath}: missing frontmatter type`);

  const withoutCodeFences = value.replaceAll(/```[\s\S]*?```/g, "");
  for (const match of withoutCodeFences.matchAll(/!?\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)) {
    const target = match[1].trim();
    const directCandidates = [
      resolve(dirname(path), target.endsWith(".md") ? target : `${target}.md`),
      resolve(repositoryRoot, target.endsWith(".md") ? target : `${target}.md`),
    ];
    if (directCandidates.some((candidate) => existsSync(candidate) && statSync(candidate).isFile())) continue;
    const matches = noteNames.get(basename(target, ".md")) ?? [];
    if (matches.length === 0) errors.push(`${displayPath}: unresolved wikilink [[${target}]]`);
    if (matches.length > 1) errors.push(`${displayPath}: ambiguous wikilink [[${target}]]`);
  }
}

const result = {
  schema_version: 1,
  vault_notes: vaultMarkdown.length,
  repository_markdown_files: repositoryMarkdown.length,
  valid: errors.length === 0,
  errors,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (errors.length > 0) process.exitCode = 1;
