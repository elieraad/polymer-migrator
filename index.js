import fs from "fs-extra";
import path from "path";
import parser from "@babel/parser";
import generator from "@babel/generator";

import { extractJavaScriptCode } from "./lib/ast.js";

const inputDirectory = process.argv[2];
const outputDirectory = process.argv[3];
const toIgnore = process.argv[4] || [];

console.log(`copying files from ${inputDirectory} to ${outputDirectory}`);
fs.copySync(inputDirectory, outputDirectory);
console.log(`all files copied\n`);

// Update bower dependencies
// Remove the existing bower_components folder
updateBowerDependencies();

// Install the new dependencies
const bowerInstallCommand = "bower install";
import { exec } from "child_process";
import { performUpgrades } from "./lib/upgrade.js";

const promise = new Promise((res) => {
  console.log("running bower install");
  const child = exec(bowerInstallCommand, { cwd: outputDirectory });

  child.stdout.on("data", (data) => {
    console.log(`${data}`);
  });

  child.on("close", (code) => {
    console.log(`child process exited with code ${code}`);
    res();
  });
});

// Perform upgrades on files
promise
  .then(() => processFiles(inputDirectory, outputDirectory))
  .then(() => console.log("Upgrade process completed."))
  .catch((err) => console.error(err));

// helpers
function updateBowerDependencies() {
  const bowerComponentsPath = path.join(outputDirectory, "bower_components");
  if (fs.existsSync(bowerComponentsPath)) {
    console.log("deleting bower_components");
    fs.rmSync(bowerComponentsPath, { recursive: true });
    console.log("bower_components deleted!\n");
  }

  // Update the Polymer version in bower.json to the latest versions
  const bowerJsonPath = path.join(outputDirectory, "bower.json");
  console.log("parsing bower.json");
  const bowerJson = JSON.parse(fs.readFileSync(bowerJsonPath, "utf-8"));

  if (bowerJson.dependencies) {
    console.log("bumping dependencies version");
    bowerJson.dependencies["polymer"] = "Polymer/polymer#^2.0.0";
    bowerJson.dependencies["webcomponentsjs"] = "webcomponents/webcomponentsjs#^1.0.0";

    for (let key of Object.keys(bowerJson.dependencies)) {
      // Check if the value starts with "PolymerElements"
      const matches = bowerJson.dependencies[key].match(/PolymerElements\/([^#]+)/i);

      if (matches) {
        bowerJson.dependencies[key] = matches[0] + "#^2.0.0";
      }
    }
  }

  if (bowerJson.devDependencies && bowerJson.devDependencies["web-component-tester"]) {
    console.log("bumping dev dependencies version");
    bowerJson.devDependencies["web-component-tester"] = "^6.0.0";
  }

  // Save the updated bower.json
  fs.writeFileSync(bowerJsonPath, JSON.stringify(bowerJson, null, 2));
  console.log("bower.json upgraded\n");
}

// Function to process files in a directory
function processFiles(inputDir, outDir) {
  fs.readdirSync(inputDir).forEach((file) => {
    const inFilePath = path.join(inputDir, file);
    const outFilePath = path.join(outDir, file);

    if (isDirectory(inFilePath)) {
      // Recursively process subdirectories
      processFiles(inFilePath, outFilePath);
    } else {
      // Process individual files
      if (inFilePath.endsWith(".html")) {
        let fileContent = fs.readFileSync(inFilePath, "utf-8");
        const generatedCode = extractJavaScriptCode(fileContent, (code) => {
          const ast = parser.parse(code, {
            sourceType: "module",
            plugins: ["jsx", "typescript"],
          });
          const classDeclaration = {
            type: "Program",
            body: performUpgrades(ast),
            sourceType: "module",
          };

          return generator.default(classDeclaration, {}, "").code;
        });

        fs.writeFileSync(outFilePath, generatedCode);
      }
    }
  });
}

function isDirectory(inFilePath) {
  const directoriesToIgnore = ["bower_components", "node_modules", ...toIgnore];

  return fs.statSync(inFilePath).isDirectory() && directoriesToIgnore.every((dir) => !inFilePath.endsWith(dir));
}
