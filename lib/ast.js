export function extractJavaScriptCode(htmlContent, transformer) {
  return htmlContent.replace(
    /<script>([\s\S]*?)<\/script>/g,
    function (match, group) {
      // Return the transformed content with the script tags
      return "<script>\n" + transformer(group) + "\n</script>";
    }
  );
}

export function extractIsProperty(metadata) {
  return metadata.properties
    .filter((p) => p.type === "ObjectProperty")
    .find((p) => p.key.name === "is");
}

export function extractMetadata(body) {
  const node = body.find((node) => {
    if (node.type !== "ExpressionStatement") return false;
    if (node.expression.type !== "CallExpression") return false;
    if (node.expression.callee.name !== "Polymer") return false;
    return true;
  });

  if (!node) {
    return null;
  }

  return node.expression.arguments[0];
}
