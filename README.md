This CLI util can help you generate Zod schemas from `interface` / `type` and `enum` declarations.

This util always assumes that your TypeScript code is valid, and `tsconfig.json` has been set properly. Garbage in, Garbage out.

Node.js Requirement: >= 16

## Usage

```
cd my-project
npm install zodify --save-dev
zodify --out-dir ./src/api/schemas
```

Your TypeScript code (assume that the path is src/a-random-directory/model.ts) may look like:

```ts
import type { Genders } from './gender'
type Name = string;

/*
 * @schema
 */
export interface Person {
  name: Name;
  age: number;
  gender: Genders;
}
```
**use jsdoc-style comment to mark the types** you want to transform to zod schemas (in this example, use a `@schema` tag as the mark).

Generated zod schema file (in ./src/api/schemas/model.ts) will look like this:

```ts
import { z } from "zod";
import { gendersSchema } from "./gender"

const nameSchema = z.string();
export const personSchema = z.object({
  name: nameSchema,
  age: z.number(),
  gender: gendersSchema
});
```

All options:

- `--tsconfig <tsconfig>`: Optional. tsconfig path of this project. Zodify will use tsconfig to find proper files(respecting `files` / `include`/`exclude` fields etc.) in the code base. Zodify will find proper tsconfig file if omitted
- `--out-dir <path>`: **Required**. the directory for generated zod schema files. ** Caution: this directory will be emptied every time zodify works**
- `--pattern`: Optional. A regex string for filter files which were found by zodify. For example: `--pattern ^src/models` let zodify find schema types under `src/models`.
- `--tag`: Optional. The tag string used in comment. Default: 'schema'
- `--name-style`: Optional. The naming style you want to use for zod schemas


use `zodify --help` to see details.

## TypeScript & Zod features & Limitations

+ Features that can be transformed between TypeScript and Zod are supported. 
+ **A `z.unknown() will be generated if Zodify find it can not be transformed from TypeScript code to Zod schema.`** You will see warning when this happens.
+ Types defined in global modules will not be recognized and transformed.

## Caution: Always use TypeScript to check schema
You should always make generated Zod schemas checked by TypeScript, to ensure their correctness.

For example, if you want to use generated zod schemas to validate HTTP response, your http request function will look like this: 

```ts
import type { ZodSchema } from "zod";
import type { Person } from './types'; // this is your source interface
import { personSchema } from './your-schemas-dir'; // this is schema generated by Zodify

function httpGet<T>(url:string, schema: ZodSchema<T>) {}


// call function with generics type parameter
// if personSchema is not correct, TypeScript will reveal it.
httpGet<Person>('/person', personSchema);
```


## Bug Report & Contribute
If you find any bug, please raise an issue.


## Roadmap

- [ ] Unit Tests
- [ ] Support Recursive Types
- [ ] Support type refinement by comments
- [ ] Support [Valibot](https://valibot.dev)
