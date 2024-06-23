import * as t from "@babel/types";

export type SchemaTypeNode = t.TSInterfaceDeclaration | t.TSTypeAliasDeclaration | t.TSEnumDeclaration;


export interface SchemaType {
  ast: SchemaTypeNode;
  isEntry: boolean;
  exported: boolean;
  exportedAsDefault: boolean;
}

export interface ImportInfo {
  origin: string; // origin name of import. special case: 'default' / '*'
  name: string; // maybe an alias, or be the same with origin. if it's a re-export, maybe '*' or 'default'
  path: string; // absolute path
  importFromSource?: boolean;
  ext?: string; // import path may have a ext name
}

export interface Module {
  topLevelTypes: SchemaType[];
  imports: ImportInfo[];
  reexports: ImportInfo[];
  filePath: string; // absolute path
}
