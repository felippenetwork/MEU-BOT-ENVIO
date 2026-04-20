import { mkdir, rm, copyFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const DOWNLOAD_DIR = path.join(ROOT_DIR, "download");

const FILES_TO_COPY = [
  ".env.example",
  "DEPLOY_VORTEXUSA.md",
  "README.md",
  "index.js",
  "package.json",
  "package-lock.json",
  "apps-script/Code.gs",
  "data/message-variants.abertura.json",
  "data/message-variants.oferta-tv.json"
];

const DOWNLOAD_README = `# Pasta de substituicao

Esta pasta foi gerada automaticamente pelo comando \`npm run download:refresh\`.

Use estes arquivos para substituir os correspondentes na hospedagem.

Arquivos incluidos:

- \`index.js\`
- \`package.json\`
- \`package-lock.json\`
- \`.env.example\`
- \`README.md\`
- \`DEPLOY_VORTEXUSA.md\`
- \`apps-script/Code.gs\`
- \`data/message-variants.abertura.json\`
- \`data/message-variants.oferta-tv.json\`

Observacoes:

- nao foi incluida a pasta \`auth/\`, porque a autenticacao precisa continuar na hospedagem
- nao foi incluido o arquivo \`.env\`, porque ele pode conter dados sensiveis
- sempre que houver nova alteracao no projeto, rode \`npm run download:refresh\` para atualizar esta pasta
`;

async function copyRelativeFile(relativePath) {
  const sourcePath = path.join(ROOT_DIR, relativePath);
  const targetPath = path.join(DOWNLOAD_DIR, relativePath);

  await mkdir(path.dirname(targetPath), { recursive: true });
  await copyFile(sourcePath, targetPath);
}

async function main() {
  await rm(DOWNLOAD_DIR, { recursive: true, force: true });
  await mkdir(DOWNLOAD_DIR, { recursive: true });

  for (const relativePath of FILES_TO_COPY) {
    await copyRelativeFile(relativePath);
  }

  await writeFile(path.join(DOWNLOAD_DIR, "LEIA-ME.md"), DOWNLOAD_README, "utf8");

  console.log("Pasta download atualizada com sucesso.");
}

main().catch((error) => {
  console.error("Falha ao atualizar a pasta download:", error);
  process.exitCode = 1;
});
