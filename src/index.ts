import { resolve, dirname, relative } from "node:path";
import { getTsconfig, createFilesMatcher } from "get-tsconfig";
import { globSync } from "glob";

import Parser, { type Config as ParserConfig } from "./Parser.js";
import Generator, {type Config as GeneratorConfig} from "./Generator.js";

export type Options = 
  & Pick<ParserConfig, 'tag'> 
  & Pick<GeneratorConfig, 'outDir'> 
  & { tsconfig?: string, pattern?: string }

export function extract(options: Options) {
  const tsconfig = getTsconfig(options.tsconfig && resolve(options.tsconfig)); 

  if (!tsconfig) {
    throw new Error(`can not find tsconfig in ${options.tsconfig || process.cwd()}`);
  }

  const allFiles = globSync('**/*', { 
    root: dirname(tsconfig.path), 
    absolute: true, 
    nodir: true, 
    ignore: ['node_modules/**', resolve(options.outDir) + '/**'] 
  });

  const matchFile = createFilesMatcher(tsconfig);
  const files = allFiles.filter(file => {
    if (!matchFile(file)) {
      return false;
    }

    if (!options.pattern) {
      return true;
    }

    const regex = new RegExp(options.pattern)
    const relativePath = relative(process.cwd(), file);

    return regex.test(relativePath);
  });

  if (files.length === 0) {
    throw new Error('Can not match any files to extract schemas.' + options.tsconfig ? `Please check your tsconfig in ${options.tsconfig}` : 'You can specify a tsconfig and try again.');
  }

  const parser = new Parser({ tsconfig, files, tag: options.tag });
  const modules = parser.extract();

  if (modules.length === 0) {
    throw new Error(`Can not find any type marked as a schema. Add /** @${options.tag} */ before the TS interface/enum/type declaration statements you want to transform.`);
  }

  const generator = new Generator({
    modules,
    outDir: resolve(options.outDir),
  });

  generator.generate();

  return [
    ...generator.warnings.unknown.length > 0 ? `Some types can not be transformed to zod schemas. Check them in: \n${generator.warnings.unknown.join('\n')}\n` : '',
    ...generator.warnings.shouldExport.length > 0 ? `Some enum types should be exported in your source files:\n ${generator.warnings.shouldExport.map(({ typeName, path }) => `${typeName} in ${path}`).join('\n')}` : ''
  ]
}

