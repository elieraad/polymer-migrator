import fs from "fs-extra";
import path from "path";
import parser from "@babel/parser";
import traverser from "@babel/traverse";
import generator from "@babel/generator";

import { kebabToPascal } from "./lib/utils.js";
import { extractIsProperty, extractJavaScriptCode, extractMetadata } from "./lib/ast.js";

const inputDirectory = process.argv[2];
const outputDirectory = process.argv[3];

console.log(`copying files from ${inputDirectory} to ${outputDirectory}`);
fs.copySync(inputDirectory, outputDirectory);
console.log(`all files copied\n`);

// Update bower dependencies
// Remove the existing bower_components folder
updateBowerDependencies();

// Install the new dependencies
const bowerInstallCommand = "bower install";
import { exec } from "child_process";

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

// Function to perform necessary upgrades on file content
function performUpgrades(ast) {
  const body = ast.program.body;
  if (body.length === 0) return [];

  let metadata = extractMetadata(body);
  if (!metadata) return body;

  const is = extractIsProperty(metadata);
  const className = kebabToPascal(is.value.value);

  const globalVars = [];
  const ops = [];

  traverser.default(ast, {
    ExpressionStatement(path) {
      path.traverse({
        ObjectProperty(innerPath) {
          const keyName = innerPath.node.key.name;

          // Check for specific properties (is, properties, observers)
          if (keyName === "is" || keyName === "properties" || keyName === "observers") {
            const staticGetter = {
              type: "ClassMethod",
              kind: "get",
              key: { type: "Identifier", name: keyName },
              params: [],
              body: {
                type: "BlockStatement",
                body: [
                  {
                    type: "ReturnStatement",
                    argument: innerPath.node.value,
                  },
                ],
              },
              computed: false,
              static: true,
            };

            // Replace the ObjectProperty with the static getter
            ops.push(() => innerPath.replaceWith(staticGetter));
          } else if (keyName === "listeners" && innerPath.node.value.type === "ObjectExpression") {
            const eventHandlers = innerPath.node.value.properties.map((property) => {
              const event = property.key.value; // Assuming keys are StringLiterals
              const handler = property.value.value;
              return {
                event,
                handler,
              };
            });

            const readyMethod = {
              type: "ClassMethod",
              kind: "method",
              key: { type: "Identifier", name: "ready" },
              params: [],
              body: {
                type: "BlockStatement",
                body: [
                  {
                    type: "ExpressionStatement",
                    expression: {
                      type: "CallExpression",
                      callee: {
                        type: "MemberExpression",
                        object: { type: "Super" },
                        property: { type: "Identifier", name: "ready" },
                      },
                      arguments: [],
                    },
                  },
                  ...eventHandlers.map(({ event, handler }) => ({
                    type: "ExpressionStatement",
                    expression: {
                      type: "CallExpression",
                      callee: {
                        type: "MemberExpression",
                        object: { type: "ThisExpression" },
                        property: {
                          type: "Identifier",
                          name: "addEventListener",
                        },
                      },
                      arguments: [
                        { type: "StringLiteral", value: event },
                        {
                          type: "MemberExpression",
                          object: { type: "ThisExpression" },
                          property: { type: "Identifier", name: handler },
                        },
                      ],
                    },
                  })),
                ],
              },
              computed: false,
              static: false,
            };

            ops.push(() => innerPath.replaceWith(readyMethod));
          } else if (innerPath.node.value.type === "FunctionExpression") {
            const keyName = innerPath.node.key.name;
            const isAsync = innerPath.node.value.async;
            const params = innerPath.node.value.params;
            const body = innerPath.node.value.body;

            const newValue = {
              type: "ObjectMethod",
              key: { type: "Identifier", name: keyName },
              params,
              body,
              computed: false,
              static: false,
              kind: "method",
              async: isAsync,
            };

            ops.push(() => innerPath.replaceWith(newValue));
          } else if (innerPath.parentPath.node === metadata) {
            const body = innerPath.node.value;

            globalVars.push({
              type: "ExpressionStatement",
              expression: {
                type: "AssignmentExpression",
                operator: "=",
                left: {
                  type: "MemberExpression",
                  object: { type: "ThisExpression" },
                  property: { type: "Identifier", name: keyName },
                },
                right: body,
              },
            });

            innerPath.remove();
          }
        },
      });
    },
  });

  ops.forEach((op) => op());

  const classDeclaration = {
    type: "ClassDeclaration",
    id: {
      type: "Identifier",
      name: className,
    },
    superClass: {
      type: "MemberExpression",
      object: {
        type: "Identifier",
        name: "Polymer",
      },
      property: {
        type: "Identifier",
        name: "Element",
      },
    },
    body: {
      type: "ClassBody",
      body: [
        {
          type: "ClassMethod",
          kind: "method",
          key: { type: "Identifier", name: "constructor" },
          params: [],
          body: {
            type: "BlockStatement",
            body: [
              {
                type: "ExpressionStatement",
                expression: {
                  type: "CallExpression",
                  callee: {
                    type: "Super",
                  },
                  arguments: [],
                },
              },
              ...globalVars,
            ],
          },
          computed: false,
          static: false,
        },
        ...metadata.properties,
      ],
    },
    decorators: [],
  };

  const defineStatement = {
    type: "ExpressionStatement",
    expression: {
      type: "CallExpression",
      callee: {
        type: "MemberExpression",
        object: {
          type: "Identifier",
          name: "customElements",
        },
        property: {
          type: "Identifier",
          name: "define",
        },
      },
      arguments: [
        {
          type: "MemberExpression",
          object: {
            type: "Identifier",
            name: className,
          },
          property: {
            type: "Identifier",
            name: "is",
          },
        },
        {
          type: "Identifier",
          name: className,
        },
      ],
    },
  };

  return [classDeclaration, defineStatement];
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
  const directoriesToIgnore = ["bower_components", "node_modules"];

  return fs.statSync(inFilePath).isDirectory() && directoriesToIgnore.every((dir) => !inFilePath.endsWith(dir));
}
