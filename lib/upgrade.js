import traverser from "@babel/traverse";
import { kebabToPascal } from "./utils.js";
import { extractIsProperty, extractMetadata } from "./ast.js";

// Function to perform necessary upgrades on file content
export function performUpgrades(ast) {
  const body = ast.program.body;
  if (body.length === 0) return [];

  let metadata = extractMetadata(body);
  if (!metadata) return body;

  const is = extractIsProperty(metadata);
  const className = kebabToPascal(is.value.value);

  const globalVars = [];
  const eventHandlers = [];
  const attributes = [];

  traverser.default(ast, {
    ExpressionStatement(path) {
      path.traverse({
        ObjectProperty(innerPath) {
          if (innerPath.parentPath.node !== metadata) return;
          const keyName = innerPath.node.key.name;

          // Check for specific properties (is, properties, observers)
          if (["is", "properties", "observers"].includes(keyName)) {
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
            innerPath.replaceWith(staticGetter);
          } else if (keyName === "listeners" && innerPath.node.value.type === "ObjectExpression") {
            eventHandlers.push(
              ...innerPath.node.value.properties.map((property) => {
                const event = property.key.value; // Assuming keys are StringLiterals
                const handler = property.value.value;
                return {
                  event,
                  handler,
                };
              })
            );

            innerPath.remove();
          } else if (keyName === "hostAttributes") {
            attributes.push(
              ...innerPath.node.value.properties.map((property) => {
                const attribute = property.key.value; // Assuming keys are StringLiterals
                const value = property.value.value;
                return {
                  attribute,
                  value,
                };
              })
            );

            innerPath.remove();
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

            innerPath.replaceWith(newValue);
          } else {
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
        {
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
              ...attributes.map(({ attribute, value }) => ({
                type: "ExpressionStatement",
                expression: {
                  type: "CallExpression",
                  callee: {
                    type: "MemberExpression",
                    object: { type: "ThisExpression" },
                    property: {
                      type: "Identifier",
                      name: "_ensureAttribute",
                    },
                  },
                  arguments: [
                    { type: "StringLiteral", value: attribute },
                    {
                      type: "StringLiteral",
                      value,
                    },
                  ],
                },
              })),
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
