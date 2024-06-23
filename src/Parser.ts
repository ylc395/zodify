import * as t from "@babel/types";
import traverse, { type NodePath } from "@babel/traverse";
import { parse as babelParse } from "@babel/parser";
import { readFileSync, existsSync } from 'node:fs'
import { dirname, extname, isAbsolute, parse, resolve } from "node:path";
import { parse as parseComment } from "doctrine";
import { groupBy, last, mapValues, memoize, mergeWith, uniqBy } from "lodash-es";
import type { SchemaTypeNode, SchemaType, ImportInfo, Module } from "./types.js";
import { type TsConfigResult, createPathsMatcher } from "get-tsconfig";

import { getFirstIdentifier } from "./utils.js";


export interface Config {
  tag: string;
  files: string[];
  tsconfig?: TsConfigResult;
}


export default class Parser {
  private readonly matchPath?: ReturnType<typeof createPathsMatcher>;

  constructor(
    private readonly config: Config,
  ) {
    this.matchPath = config.tsconfig && createPathsMatcher(config.tsconfig);
  }

  public extract() {
    const modules: Module[] = [];

    for (const filePath of this.config.files) {
      const parsedFile = this.parseFile(filePath)

      for (const type of parsedFile.topLevelTypes) {
        if (type.isEntry) {
          const resolved = this.resolveType(type.ast.id.name, parsedFile);
          resolved && modules.push(...resolved);
        }
      }
    }

    return Parser.mergeModules(modules);
  }

  private readonly resolveType = memoize((typeName: string, module: Module, stack: { path: Module['filePath'], type: string }[] = []): Module[] | null => {
    if(stack.find((frame) => module.filePath === frame.path && typeName === frame.type)) {
      // todo: support circular reference
      throw new Error(`circular reference ${JSON.stringify(stack)}`, );
    }

    const modules: Module[] = [];

    // 1. find type in top-level types
    const targetType = module.topLevelTypes.find(({ ast, exportedAsDefault }) => ast.id.name === typeName || (typeName === 'default' && exportedAsDefault));

    if (targetType) {
      const imports: ImportInfo[] = [];
      const isRuntimeType = t.isTSEnumDeclaration(targetType.ast);

      if (isRuntimeType) {
        imports.push({
          origin: typeName,
          name: typeName,
          path: module.filePath,
          importFromSource: true,
        });
      } else {
        traverse.default(targetType.ast, {
          noScope: true,
          TSEntityName: (path) => {
            const { node, parent } = path;

            if (!t.isTSTypeReference(parent) && !t.isTSExpressionWithTypeArguments(parent)) {
              path.skip();
              return;
            }

            const depTypeName = t.isIdentifier(node) ? node.name : getFirstIdentifier(node);
            const innerType = module.topLevelTypes.find(({ ast }) => ast.id.name === depTypeName);

            if (innerType) {
              const resolved = this.resolveType(depTypeName, module, [...stack, { path: module.filePath, type: typeName }]);
              resolved && modules.unshift(...resolved);
            }

            const importType = module.imports.find(({ name }) => name === depTypeName);

            if (importType) {
              const resolved = this.resolveType(importType.origin, this.parseFile(importType.path), [...stack, { path: module.filePath, type: typeName }]);

              // for example: try to resolve a class
              if (!resolved) {
                return;
              }

              imports.push(importType);
              modules.unshift(...resolved);
            }
          }
        });
      }

      modules.push({
        filePath: module.filePath,
        reexports: [],
        topLevelTypes: [targetType],
        imports,
      })

      return modules;
    } 
    
    // 2. find type in re-export with name and re-export-all
    const targetReexport = module.reexports.find(({ name }) => name === typeName);
    const reexports =  targetReexport ? [targetReexport] : module.reexports.filter(({ name }) => name === '*').reverse();

    for (const reexport of reexports) {
      const resolved = this.resolveType(typeName, this.parseFile(reexport.path), [...stack, { path: module.filePath, type: typeName }])

      if (resolved) {
        modules.push({
          filePath: module.filePath,
          topLevelTypes: [],
          imports: [],
          reexports: [reexport],
        })

        return modules;
      }
    }

    return null;
  }, (typeName, { filePath }) => `${filePath}-${typeName}`);

  private readonly parseFile = memoize((filePath: string): Module => {
    const imports: ImportInfo[] = [];
    const reexports: ImportInfo[] = [];
    const topLevelTypes: SchemaType[] = [];

    
    const text = readFileSync(filePath, { encoding: 'utf-8' });
    let ast: t.Node;

    try {
      ast = babelParse(text, { plugins: ['typescript'], sourceType: 'module' });
    } catch (error) {
      return { topLevelTypes, reexports, imports, filePath };      
    }


    const collectTopLevelTypes = (astPath: NodePath<SchemaTypeNode>) => {
      const comment = last(astPath.node.leadingComments || astPath.parent.leadingComments);
      let isEntry = false;

      if (comment) {
        const { tags } = parseComment(comment.value, { unwrap: true })
        isEntry = tags.some(({ title } ) => title === this.config.tag);
      }


      if(astPath.scope.parent) {
        if (isEntry) {
          throw Error(`can not mark a non-top-level type as schema(${filePath})`)
        }
        return;
      }

      const exportedAsDefault = t.isExportDefaultDeclaration(astPath.parent);
      const exported = exportedAsDefault || t.isExportDeclaration(astPath.parent);

      if (!exported && isEntry) {
        throw new Error(`can not mark a not-exported type as schema(${filePath})`);
      }

      topLevelTypes.push({
        ast: astPath.node,
        isEntry,
        exported, 
        exportedAsDefault,
      });
    };

    const collectImports = (astPath: NodePath<t.ImportDeclaration>) => {
      for (const specifier of astPath.node.specifiers) {
        const path = this.resolvePath(astPath.node.source.value, filePath);

        if (path) {
          imports.push({
            origin: t.isImportDefaultSpecifier(specifier) ? 'default' : (t.isImportNamespaceSpecifier(specifier) ? '*' : (t.isIdentifier(specifier.imported) ? specifier.imported.name : specifier.imported.value)),
            name: specifier.local.name,
            path,
            ext: extname(astPath.node.source.value),
          });
        }
      }
    };

    const collectReexports = (astPath: NodePath<t.ExportNamedDeclaration | t.ExportAllDeclaration>) => {
      if (!astPath.node.source) {
        return;
      }

      if (t.isExportAllDeclaration(astPath.node)) {
        const path = this.resolvePath(astPath.node.source.value, filePath);

        path && reexports.push({
          origin: '*',
          name: '*',
          path,
          ext: extname(astPath.node.source.value),
        });

        return;
      }

      for (const specifier of astPath.node.specifiers) {
        if (t.isExportDefaultSpecifier(specifier)) {
          throw new Error(`unexpected export specifier in ${filePath}`);
        }
        
        const path = this.resolvePath(astPath.node.source.value, filePath);

        if (path) {
          reexports.push({
            origin: t.isExportNamespaceSpecifier(specifier) ? '*' : specifier.local.name,
            name: t.isIdentifier(specifier.exported) ? specifier.exported.name : specifier.exported.value,
            path,
            ext: extname(astPath.node.source.value),
          });
        }
      }

    };

    traverse.default(ast, {
      TSInterfaceDeclaration: collectTopLevelTypes,
      TSTypeAliasDeclaration: collectTopLevelTypes,
      TSEnumDeclaration: collectTopLevelTypes,
      ImportDeclaration: collectImports,
      ExportNamedDeclaration: collectReexports,
      ExportAllDeclaration: collectReexports,
    });

    return { topLevelTypes, imports, reexports, filePath };
  });

  // todo: its result must be an array, not a value
  private resolvePath(path: string, fromFile: string)  {
    const matchedPath = this.matchPath?.(path);
    const resolvedPath = (matchedPath?.length ? matchedPath : [isAbsolute(path) ? path : resolve(dirname(fromFile), path)])
        .map(p => {
          const { dir, name } = parse(p)
          return `${dir}/${name}.ts`;
        })
        .find((p) => existsSync(p));
    
    return resolvedPath;
  };


  private static mergeModules(modules: Module[]) {
    const modulesGroup: Record<Module['filePath'], Module> = mapValues(groupBy(modules, ({ filePath }) => filePath), ms => mergeWith({}, ...ms, (objVal: unknown, srcVal: unknown) => {
      if (Array.isArray(objVal)) {
        return objVal.concat(srcVal);
      }
    }));
    const mergedModules: Module[] = Object.values(modulesGroup).map(module => ({
      imports: uniqBy(module.imports, ({ name }) => name),
      topLevelTypes: uniqBy(module.topLevelTypes, ({ ast }) => ast.id.name),
      reexports: uniqBy(module.reexports, ({ name, path}) => `${name}-${path}`),
      filePath: module.filePath,
    }));


    return mergedModules;
  }
}
