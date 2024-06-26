import * as t from "@babel/types"; 
import { camelCase, kebabCase, snakeCase } from "lodash-es";
  
export function getFirstIdentifier({ left }: t.TSQualifiedName): string {
  if (t.isIdentifier(left)) {
      return left.name;
  }

  return getFirstIdentifier(left);
}
export const nameTransformers = { camelCase, snakeCase, kebabCase };