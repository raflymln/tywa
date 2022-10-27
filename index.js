#!/usr/bin/env node
"use strict";
const esbuild = require("esbuild");
const glob = require("fast-glob");
const fs = require("fs");
const path = require("path");
const chokidar = require("chokidar");
const childProcess = require("child_process");
const tsConfig = require("./tsconfig.json");

const isWatch = !!process.argv.find((argItem) => argItem === "--watch");
const isProduction = !!process.argv.find((argItem) => argItem === "--production");

const compilerOptions = {
    outdir: tsConfig.compilerOptions.outDir,
    bundle: false,
    platform: "node",
    target: "esnext",
    format: "cjs",
    minify: isProduction,
};

const unWatchedDirectories = ["commands"];

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

            for (const [alias, resolveFolder] of Object.entries(tsConfig.compilerOptions.paths)) {
                const rootDir = tsConfig.compilerOptions.rootDir;

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
        const projectRoot = path.resolve(tsConfig.compilerOptions.rootDir);
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

    const projectRoot = `${tsConfig.compilerOptions.rootDir}/**/*.ts`;

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

            for (const dir of unWatchedDirectories) {
                if (path.dirname(file).includes(dir)) {
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
