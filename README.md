# 🚀 TYWA - Typescript Wrapper 

Tywa is a fast Typescript compiler dedicated for NodeJS environment only (no client code/html), built on top of EsBuild. It's made to be used with a minimum configuration needed with some added features like:

1. Automatic code splitting

With Tywa, the output code wouldn't be bundled into single file, instead it will be splitted into multiple files based on the code structure. This is useful for code splitting and lazy loading.

2. Watch mode (with child process)

Tywa will watch for file changes and recompile the code. It will also spawn a child process to run the code, and will restart the child process when the code is recompiled. With this, you don't have to restart the process manually.

3. Automatic import alias fix

If you're using import path alias that is defined in `tsconfig.json`, Tywa will automatically fix the import path to the correct path.

Example: 

> tsconfig.json
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  }
}
```

> src/index.ts
```ts
import foo from '@/foo'
```

will be compiled to

> dist/index.js
```js
const foo = require('./src/foo')
```

---
> ### 🐠🌊 Tywa was originally made for Hupa, but I decided to make it public so that it can be used by others. If you're interested in Hupa, you can check it out [here](https://github.com/raflymln/hupa).
---

## 📥 Installation

### 1. Install Tywa to your project

```bash
#npm
npm install tywa 

#yarn
yarn add tywa 

#pnpm
pnpm add tywa 
```

### 2. Create the configuration

You can choose to create the configuration file (`.tywa`, `*.js`, or `.json`) or just put it on `package.json` or in `tsconfig.json`.

```json
{
    "outDir": "dist",
    "unWatchedDirectories": [
        "commands"
    ],
    "paths": {
        "@/*": ["src/*"]
    },
    "rootDir": "src",
    "tsconfig": "tsconfig.json",
    "mainOutputFile": "index.js",
}
``` 
#### Configuration Note:

1. `tsconfig` are optional, Tywa will search for tsconfig.json file in the current directory and use the configuration from there. 

2. `rootDir`, `outDir`, and `paths` is also optional, Tywa will use the configuration from `tsconfig.json` if it's not defined. 

    But if you define it in the configuration file, it will override the configuration from `tsconfig.json`.

3. `unWatchedDirectories` is optional, it wasn't exclude the directory from being watched, but it will mark specified directory to not trigger the child process to restart when any changes is made in the directory while using watch mode. 

    It's useful for commands directory (for bots), so you don't have to restart the child process when you're developing the command. The code will be recompiled, but the child process won't be restarted. You can develop hot module reloading in the parent file with this.

Learn more about this in [Configuration](#-configuration)

### 3. Compile the code

```bash
# Use --watch to enable watch mode
# Use --production to enable production mode (minify the code)
# Use --config to specify the configuration file (will automatically search for .tywa, *.js, or *.json if not specified)

#npm
npm tywa

#yarn
yarn tywa

#pnpm
pnpm tywa
```

## 📝 Configuration & Examples

### 1. Supposed that you have a project with the following structure:

```
project
├── src
│   ├── index.ts
│   ├── foo.ts
│   ├── bar.ts
│   └── commands
│       ├── ping.ts
│       └── help.ts
├── tsconfig.json
└── package.json
```

### 2. And the `tsconfig.json` is:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "outDir": "dist",
    "rootDir": "src",
    "paths": {
      "@/*": ["src/*"]
    },
  }
}
```

Please note that if you not define one of those keys (`outDir`, `rootDir`, or `paths`), Tywa will use the keys from the tywa configuration file, so make sure you have define it in the tsconfig.json file or in the tywa configuration file.

Learn more [here](#configuration-note)

### 3. And the `src/index.ts` is:

```ts
import foo from '@/foo'
import bar from '@/bar'
```

### 4. You have 3 options to create Tywa configuration:

1. In the package.json

```json
{
    "tywa": {
        "mainOutputFile": "index.js",
        "unWatchedDirectories": [
            "commands"
        ],
    }
}
```

2. In the tsconfig.json

```json
{
    "tywaOptions": {
        "mainOutputFile": "index.js",
        "unWatchedDirectories": [
            "commands"
        ],
    }
}
```

3. In the `.tywa`, or in any `.js`, or `.json` file
> If you are using any `.js` or `.json` file, you need to specify the file relative path in the `--config` option when running Tywa.
>
> Example: `npm tywa --config ./tywa.config.js`

Example JSON file:
```json
{
    "mainOutputFile": "index.js",
    "unWatchedDirectories": [
        "commands"
    ],
}
```

Example JS file:
```js
module.exports = {
    mainOutputFile: "index.js",
    unWatchedDirectories: [
        "commands"
    ],
}
```

### 5. The output will be:

The project structure:

```
project
├── src
│   ├── index.ts
│   ├── foo.ts
│   ├── bar.ts
│   └── commands
│       ├── ping.ts
│       └── help.ts
├── dist
│   ├── index.js
│   ├── foo.js
│   ├── bar.js
│   └── commands
│       ├── ping.js
│       └── help.js
├── tsconfig.json
└── package.json
```

And the `dist/index.js` will be:

```js
const foo = require('./foo')
const bar = require('./bar')
```

### 6. Let's say you are using Watch mode
> To use watch mode, you need to add `--watch` option when running Tywa
>
> Example: `npm tywa --watch`

Because you define `index.js` as the main output file, Tywa will run the `dist/index.js` file as a child process, and it will restart the child process when any changes is made in the project directory (all directories under the `rootDir`).

But you also define `commands` as the `unWatchedDirectories`, so when you make any changes in the `commands` directory, the child process won't be restarted.

## 🎁 Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

