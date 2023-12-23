export function kebabToCamel(str) {
  return str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

export function kebabToPascal(str) {
  const camelCaseString = kebabToCamel(str);
  return camelCaseString.charAt(0).toUpperCase() + camelCaseString.slice(1);
}
