#!/usr/bin/env node
import { Option, program } from "commander";
import chalk from "chalk";
import { extract, type Options } from "./index.js";
import { nameTransformers } from "./utils.js";

program
  .name('zodify')
  .option('--tsconfig <tsconfig>', 'File path for tsconfig of this project')
  .requiredOption('--out-dir <outDir>', 'Directory path for generated schema files')
  .option('--pattern <pattern>', 'Regex string to match entry files')
  .option('--tag <tag>', 'Specify a comment tag as the indicator of entry', 'schema')
  .addOption(new Option('--name-style <nameStyle>', 'Specify a name style for generated schema').choices(Object.keys(nameTransformers)))
  .parse()

const options = program.opts<Options>();
let warnings: string[] = [];

try {
  warnings = extract(options);
} catch (error) {
  if (error instanceof Error) {
    console.log(chalk.red(error.message));
  }
  process.exit();
}

if (warnings.length === 0) {
  console.log(chalk.green(`🎉 Zod schemas were generated successfully in ${options.outDir}`));
} else {
  console.log(chalk.yellow(`Zod schemas were generated successfully in ${options.outDir}. But there are some issues you need to check.\n\n${warnings.join('')}`));
}
