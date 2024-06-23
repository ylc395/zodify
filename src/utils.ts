import * as t from "@babel/types"; 
  
export function getFirstIdentifier({ left }: t.TSQualifiedName): string {
  if (t.isIdentifier(left)) {
      return left.name;
  }

  return getFirstIdentifier(left);
}