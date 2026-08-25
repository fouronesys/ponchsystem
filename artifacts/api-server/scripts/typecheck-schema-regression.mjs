import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const artifactDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceDirectory = path.resolve(artifactDirectory, "../..");
const schemaPath = path.join(workspaceDirectory, "lib/db/src/schema/attendance.ts");
const fixturePath = path.join(artifactDirectory, "src/typecheck-schema-regression.fixture.ts");
const marker = "fresh-schema-declaration";
const markerDeclaration = `\nexport const typecheckSchemaRegressionMarker = "${marker}" as const;\n`;
const fixture = `import { typecheckSchemaRegressionMarker } from "@workspace/db";\n\nconst expectedMarker: "${marker}" = typecheckSchemaRegressionMarker;\nvoid expectedMarker;\n`;

function runTypecheck(args) {
  return execFileSync("pnpm", args, {
    cwd: workspaceDirectory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runExpectedFailure(args) {
  try {
    runTypecheck(args);
  } catch (error) {
    const output = `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
    if (error.status !== 0 && output.includes("typecheckSchemaRegressionMarker")) {
      return;
    }
    throw error;
  }
  throw new Error("The stale declaration check unexpectedly passed.");
}

const originalSchema = readFileSync(schemaPath, "utf8");

try {
  runTypecheck(["exec", "tsc", "--build", "lib/db/tsconfig.json", "--force"]);
  writeFileSync(schemaPath, `${originalSchema}${markerDeclaration}`);
  writeFileSync(fixturePath, fixture);

  runExpectedFailure(["exec", "tsc", "-p", "artifacts/api-server/tsconfig.json", "--noEmit"]);
  runTypecheck(["--filter", "@workspace/api-server", "run", "typecheck"]);
} finally {
  writeFileSync(schemaPath, originalSchema);
  rmSync(fixturePath, { force: true });
  runTypecheck(["exec", "tsc", "--build", "lib/db/tsconfig.json", "--force"]);
}

console.log("Schema declaration regression check passed.");