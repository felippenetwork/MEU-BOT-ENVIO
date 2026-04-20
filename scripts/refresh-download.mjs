import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const DOWNLOAD_DIR = path.join(ROOT_DIR, "download");

function normalizeRelativePath(inputPath) {
  const normalized = path.normalize(String(inputPath || "").trim()).replace(/^([\\/])+/, "");
  const absolute = path.resolve(ROOT_DIR, normalized);

  if (!normalized) {
    throw new Error("Informe pelo menos um arquivo ou pasta para copiar para download/.");
  }

  if (!absolute.startsWith(ROOT_DIR)) {
    throw new Error(`Caminho fora do projeto nao permitido: ${inputPath}`);
  }

  return normalized;
}

async function copyEntry(relativePath) {
  const sourcePath = path.join(ROOT_DIR, relativePath);
  const entryStats = await stat(sourcePath);

  if (entryStats.isDirectory()) {
    const childEntries = await readdir(sourcePath);
    for (const childEntry of childEntries) {
      await copyEntry(path.join(relativePath, childEntry));
    }
    return;
  }

  const targetPath = path.join(DOWNLOAD_DIR, relativePath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await copyFile(sourcePath, targetPath);
}

async function main() {
  const requestedEntries = process.argv.slice(2).map(normalizeRelativePath);

  if (requestedEntries.length === 0) {
    throw new Error(
      "Use `npm run download:refresh -- arquivo1 arquivo2` para copiar somente os arquivos atualizados."
    );
  }

  await rm(DOWNLOAD_DIR, { recursive: true, force: true });
  await mkdir(DOWNLOAD_DIR, { recursive: true });

  for (const relativePath of requestedEntries) {
    await copyEntry(relativePath);
  }

  console.log("Pasta download atualizada somente com os arquivos solicitados.");
}

main().catch((error) => {
  console.error("Falha ao atualizar a pasta download:", error.message);
  process.exitCode = 1;
});
