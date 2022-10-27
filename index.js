#! /usr/bin/env node

"use strict";
const esbuild = require("esbuild");
const glob = require("fast-glob");
const fs = require("fs");
const path = require("path");
const chokidar = require("chokidar");
const childProcess = require("child_process");

const isProduction = !!process.argv.find((argItem) => argItem === "--production");
const isWatch = !isProduction && !!process.argv.find((argItem) => argItem === "--watch");

/**
 * Esbuild compiler options
 * @type {{
 *  outDir: string,
 *  unWatchedDirectories: string[],
 *  paths: Record<string, [string]>,
 *  rootDir: string,
 *  tsconfig: string,
 *  mainOutputFile: string,
 * }}
 */
let compilerConfig = {};

/**
 * Typescript compiler options
 * @type {{
 *  paths: Record<string, [string]>,
 *  rootDir: string,
 *  outDir: string,
 * }}
 */
let tsCompilerConfig = {};

let configPath = "";
const argvConfigPath = process.argv.findIndex((argItem) => argItem.startsWith("--config"));
const isThereConfigFile = argvConfigPath !== -1;

if (isThereConfigFile) {
    const rawConfigPath = process.argv[argvConfigPath];

    if (rawConfigPath.includes("=")) {
        configPath = rawConfigPath.split("=")[1];
    } else {
        configPath = process.argv[argvConfigPath + 1];
    }

    if (!configPath) {
        throw new Error("Config file path is not defined or invalid in --config argument");
    }

    configPath = path.isAbsolute(configPath) //
        ? configPath
        : path.join(process.cwd(), configPath);

    if (!fs.existsSync(configPath)) {
        throw new Error("Config file does not exist");
    }

    if (fs.lstatSync(configPath).isDirectory()) {
        throw new Error("Config file path is a directory");
    }

    const configFileExt = path.extname(configPath);
    const configFileName = path.basename(configPath);
    const resolvedConfigPath = path.resolve(configPath);

    const upsertTsConfig = (config) => {
        const rawTsConfigPath = config.tsconfig;

        if (rawTsConfigPath) {
            const tsConfigPath = path.isAbsolute(rawTsConfigPath) //
                ? rawTsConfigPath
                : path.join(process.cwd(), rawTsConfigPath);

            if (fs.existsSync(tsConfigPath)) {
                tsCompilerConfig = require(tsConfigPath).compilerOptions;
            }
        }
    };

    try {
        // Javascript config file
        if (configFileExt === ".js") {
            compilerConfig = require(resolvedConfigPath);
            upsertTsConfig(compilerConfig);
        }

        // JSON config file (*.json or .tywa)
        if (configFileExt === ".json" || configFileName === ".tywa") {
            if (configFileName === "tsconfig.json") {
                const rawTsConfig = require(resolvedConfigPath);

                if (rawTsConfig.tywaOptions) {
                    compilerConfig = rawTsConfig.tywaOptions;
                }

                if (rawTsConfig.compilerOptions) {
                    tsCompilerConfig = rawTsConfig.compilerOptions;
                }
            } else if (configFileName === "package.json") {
                const packageJson = require(resolvedConfigPath);

                if (!packageJson.tywa) {
                    throw new Error("`tywa` property is not defined in package.json");
                }

                compilerConfig = packageJson.tywa;
                upsertTsConfig(compilerConfig);
            } else {
                compilerConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
                upsertTsConfig(compilerConfig);
            }
        }

        throw new Error("Config file must be a js, json or `.tywa` file");
    } catch (error) {
        throw new Error(`Failed to parse config file: ${error.message}`);
    }
} else {
    const isExists = (file) => fs.existsSync(path.join(process.cwd(), file));
    const getFile = (file) => path.join(process.cwd(), file);

    if (isExists("tsconfig.json")) {
        tsCompilerConfig = require(getFile("tsconfig.json"));

        if (tsCompilerConfig.tywaOptions) {
            compilerConfig = tsCompilerConfig.tywaOptions;
        }

        if (tsCompilerConfig.compilerOptions) {
            tsCompilerConfig = tsCompilerConfig.compilerOptions;
        }
    } else if (isExists("package.json")) {
        const packageJson = require(getFile("package.json"));

        if (!packageJson.tywa) {
            throw new Error("`tywa` property is not defined in package.json");
        }

        compilerConfig = packageJson.tywa;
        upsertTsConfig(compilerConfig);
    } else if (isExists(".tywa")) {
        compilerConfig = JSON.parse(fs.readFileSync(getFile(".tywa"), "utf8"));
        upsertTsConfig(compilerConfig);
    }
}

const getRelativePath = (filePath) => {
    if (!filePath) {
        return undefined;
    }

    if (path.isAbsolute(filePath)) {
        return path.relative(process.cwd(), filePath);
    }

    return filePath;
};

compilerConfig = {
    outDir: getRelativePath(compilerConfig.outDir || tsCompilerConfig.outDir),
    rootDir: getRelativePath(compilerConfig.rootDir || tsCompilerConfig.rootDir),
    paths: compilerConfig.paths || tsCompilerConfig.paths || {},
    unWatchedDirectories: compilerConfig.unWatchedDirectories || [],
    mainOutputFile: compilerConfig.mainOutputFile || undefined,
};

if (!compilerConfig.outDir) {
    throw new Error("Output directory is not defined");
}

if (!compilerConfig.rootDir) {
    throw new Error("Root directory is not defined");
}

if (!compilerConfig.mainOutputFile && isWatch) {
    throw new Error("Main output file is not defined");
}

if (!compilerConfig.paths) {
    console.warn("Paths are not defined, if your project uses aliases in imports, tywa will not fix them");
}

console.log("Tywa is running in", isProduction ? "production" : "development", "mode");

const compilerOptions = {
    outdir: compilerConfig.outDir,
    bundle: false,
    platform: "node",
    target: "esnext",
    format: "cjs",
    minify: isProduction,
};

/**
 * Fix all file import paths that using typescript paths,
 * esbuild doesn't support typescript paths
 */
const fixFileImportPaths = () => {
    // Glob to all files in output folder
    const files = glob.sync(`./${compilerOptions.outdir}/**/*.js`);

    for (const file of files) {
        let content = fs.readFileSync(file, "utf8");

        // Search for require(x) in output file
        const requireRegex = /require\((['"])(.*?)\1\)/g;
        const matches = content.matchAll(requireRegex);

        // Skip if no matches
        if (!matches) continue;

        for (const match of matches) {
            // importPath will be like `@/folder/file` without the quotes
            const [, , importPath] = match;
            let pathReplacement = "";

            for (const [alias, resolveFolder] of Object.entries(compilerConfig.paths)) {
                const rootDir = compilerConfig.rootDir;

                // This will remove `*` from the end of the path also replacing source folder name with output folder name
                // Example: "@/*": ["src/*"] -> "@/": ["/dist"]
                const pathToReplace = alias.replace("*", "").replace(rootDir, compilerOptions.outdir);
                const pathToReplaceWith = resolveFolder[0].replace("*", "").replace(rootDir, compilerOptions.outdir);

                if (importPath.startsWith(pathToReplace)) {
                    // Replace path with new path, Example: "@/commands" -> "dist/commands"
                    const parsedPath = importPath.replace(pathToReplace, pathToReplaceWith);

                    // Will resolve path to absolute path, Example: "dist/commands" -> "/home/user/project/dist/commands"
                    const modulePath = path.resolve(parsedPath);
                    const filePath = path.resolve(file);

                    // Will get the relatives from 2 absolute paths, Example: from "/home/user/project/dist/commands" -> to "/home/user/project/dist" will resolve to "../"
                    // The reason why i put the dirname here is because we are finding the relative from current file folder to the module file location
                    // Example file `/dist/commands/player/stop.js` will parsed to `/dist/commands/player`
                    // Result: from: /dist/commands/player -> to: /dist/lib/lavalink, will resolve to "../../lib/lavalink"
                    pathReplacement = path.relative(path.dirname(filePath), modulePath);

                    // Replace all backslashes with forward slashes (because NodeJS uses forward slashes)
                    pathReplacement = pathReplacement.replace(/\\/g, path.posix.sep);

                    // If the resolve path is on the same directory, it will output something like "index" instead of "./index"
                    // NodeJS then will try to load the module from node_modules folder, so we need to add "./" to the path
                    // to make sure it will load the file from the same directory
                    if (!pathReplacement.startsWith(".")) {
                        pathReplacement = "./" + pathReplacement;
                    }

                    content = content.replace(importPath, pathReplacement);
                }
            }
        }

        fs.writeFileSync(file, content);
    }
};

/**
 * Build a single or multiple file into output folder
 *
 * @param {string | string[]} file
 */
const buildFile = async (file) => {
    let outdir = "";
    let entryPoints = [];

    if (typeof file === "string") {
        entryPoints = [file];

        // It will get the current file directory and replace the source folder name with output folder name
        // Example: "src/commands/player/stop.js" -> "dist/commands/player/stop.js"
        const projectRoot = path.resolve(compilerConfig.rootDir);
        const filePath = path.resolve(file);
        const relativePath = path.relative(projectRoot, filePath);
        outdir = path.posix.join(compilerOptions.outdir, path.dirname(relativePath).replace(/\\/g, path.posix.sep));
    } else if (typeof file === "object" && Array.isArray(file)) {
        entryPoints = file;
        outdir = compilerOptions.outdir;
    } else {
        throw new Error("Invalid file type");
    }

    const result = await esbuild.build({
        ...compilerOptions,
        entryPoints,
        outdir,
        metafile: !isProduction,
    });

    if (result.errors.length === 0) {
        fixFileImportPaths();
        console.log(`File ${file} compiled successfully.`);
    } else {
        console.log(`Failed to compile file ${file}`);
    }
};

/**
 * Build all files in source folder
 * If watch mode is enabled, it will watch for file changes
 * and build the file that changed
 */
const compile = async () => {
    if (fs.existsSync(compilerOptions.outdir)) {
        fs.rmSync(compilerOptions.outdir, { recursive: true });
    }

    const projectRoot = `${compilerConfig.rootDir}/**/*.ts`;

    const files = glob.sync(projectRoot, {
        ignore: ["**.d.ts", "**/*.test.ts"],
    });

    await buildFile(files);

    if (isWatch) {
        console.log("Watching for file changes and starting child process...");

        const mainOutputFile = path.resolve(compilerOptions.outdir, "index.js");
        const watcher = chokidar.watch(projectRoot);

        /** @type {childProcess.ChildProcess} */
        let child = null;
        let isChildRunning = true;

        const startChild = () => {
            /** @param {childProcess.Serializable} message */
            const onMessage = (message) => {
                if (message === "exit") {
                    child.off("message", onMessage);
                    child.kill();

                    if (isChildRunning) {
                        console.log("Starting new child process...");
                        startChild();
                    } else {
                        console.log("Exiting...");
                        process.exit();
                    }
                }
            };

            child = childProcess.fork(mainOutputFile);
            child.on("message", onMessage);
        };

        startChild();

        watcher.on("add", async (file) => {
            console.log(`File ${file} has been added to watch list.`);
        });

        watcher.on("change", async (file) => {
            await buildFile(file);

            console.log(`File changed: ${file}`);

            for (const dir of compilerConfig.unWatchedDirectories) {
                if (file.includes(dir)) {
                    return;
                }
            }

            console.log("Stopping child process...");
            child.send("beforeExit");
        });

        const exitEvents = ["beforeExit", "exit", "SIGINT", "SIGUSR1", "SIGUSR2", "SIGTERM"];

        for (const eventName of exitEvents) {
            process.once(eventName, () => {
                process.stdin.resume();

                if (isChildRunning) {
                    child.send("beforeExit");
                }

                isChildRunning = false;
            });
        }
    }
};

compile();
