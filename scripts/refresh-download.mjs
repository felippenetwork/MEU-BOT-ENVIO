import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const DOWNLOAD_DIR = path.join(ROOT_DIR, "download");
const RETRYABLE_FS_ERROR_CODES = new Set(["EBUSY", "ENOTEMPTY", "EPERM"]);

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

async function removePathWithRetry(targetPath, maxAttempts = 5) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await rm(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      const isRetryable = RETRYABLE_FS_ERROR_CODES.has(error?.code);
      if (!isRetryable || attempt === maxAttempts) {
        throw error;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, attempt * 500);
      });
    }
  }
}

async function clearDownloadDir() {
  await mkdir(DOWNLOAD_DIR, { recursive: true });
  const entries = await readdir(DOWNLOAD_DIR, { withFileTypes: true });

  for (const entry of entries) {
    const targetPath = path.join(DOWNLOAD_DIR, entry.name);

    if (entry.isDirectory()) {
      await clearDirectoryContents(targetPath);
      try {
        await removePathWithRetry(targetPath);
      } catch (error) {
        if (!RETRYABLE_FS_ERROR_CODES.has(error?.code)) {
          throw error;
        }
      }
      continue;
    }

    await removePathWithRetry(targetPath);
  }
}

async function clearDirectoryContents(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const targetPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      await clearDirectoryContents(targetPath);
    }

    await removePathWithRetry(targetPath);
  }
}

async function main() {
  const requestedEntries = process.argv.slice(2).map(normalizeRelativePath);

  if (requestedEntries.length === 0) {
    throw new Error(
      "Use `npm run download:refresh -- arquivo1 arquivo2` para copiar somente os arquivos atualizados."
    );
  }

  await clearDownloadDir();
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
